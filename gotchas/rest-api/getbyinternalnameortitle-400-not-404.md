---
title: "`fields/getbyinternalnameortitle` returns 400, not 404, for a missing field"
short-title: "`fields/getbyinternalnameortitle` 400s for a missing field"
summary: It throws `ArgumentException` (HTTP 400), not 404; an existence-check that hard-fails on non-404 breaks the "field missing → create" path, and one that creates on any non-200 duplicates the column when throttled
tags: [rest-api, fields, provisioning, existence-check]
applies-to: SharePoint REST (/_api/web/lists(...)/fields/getbyinternalnameortitle), field provisioning
last-reviewed: 2026-09-24
---

# `fields/getbyinternalnameortitle` returns 400, not 404, for a missing field

> **Bottom line.** When you probe for a field with `.../fields/getbyinternalnameortitle('X')` and the field doesn't exist, SharePoint answers **HTTP 400** (`System.ArgumentException — Column 'X' does not exist`), not the 404 you'd expect from a "get by name" lookup. An existence-check that treats "not 200 and not 404" as a hard error will wrongly fail on the normal "field is missing → create it" path.
>
> **Ve zkratce.** Když ověřuješ existenci pole přes `.../fields/getbyinternalnameortitle('X')` a pole neexistuje, SharePoint vrátí **HTTP 400** (`System.ArgumentException – Sloupec 'X' neexistuje`), NE 404. Existence-check, který bere „ne 200 a ne 404“ jako tvrdou chybu, pak spadne na úplně normální cestě „pole chybí → vytvoř ho“.

## Symptom

You add a column to a list only if it isn't there yet (to stay idempotent — a blind POST to `/fields`
with an existing Title silently creates a duplicate with a suffixed InternalName). Your check looks like:

```ts
const chk = await sp.get(`${listUrl}/fields/getbyinternalnameortitle('MyField')?$select=InternalName`);
if (chk.ok) return; // already exists
if (chk.status !== 404) throw new Error(`check failed HTTP ${chk.status}`); // ← fires on 400
// 404 → create it
```

On a list where the field genuinely doesn't exist, the check returns **HTTP 400**, so your code throws
`check failed HTTP 400` and never creates the column — the exact case it was meant to handle. The error
body is explicit: `{"error":{"code":"-2147024809, System.ArgumentException","message":"Column 'MyField' does not exist…"}}`.

## Cause

`getbyinternalnameortitle` isn't a soft lookup that returns `null`/404 for a miss — it resolves the field
server-side and, when the name matches nothing, raises `ArgumentException`, which SharePoint surfaces as
**HTTP 400** (`-2147024809` = `0x80070057`, E_INVALIDARG). Several other `GetByX` endpoints behave the same
way (they throw rather than 404 on a miss). So "404 means missing" is an unsafe assumption here.

Concrete sibling: **`sitegroups/getbyname('Missing')` returns HTTP 500** (`Group cannot be found`), not 404, for a nonexistent group. A provisioning existence-check written as `if (status !== 404) { skip }` therefore *never* reaches the create branch on a fresh web (missing group → 500 → skipped forever), so the groups are silently never created. Same rule, different status code: don't branch a `getby*` existence-check on a specific non-OK status — treat only 200 as "exists" and let the create decide, **but only where the create fails loudly on a duplicate**. A group with a taken name is rejected, so the create is a safe tiebreaker there. A field is not: a second `POST /fields` with the same name succeeds and makes `MyField0`, so for fields "not OK" splits into "missing" (400/404) and "unknown" (everything else, which must not create — see the Fix below).

Found in the wild twice more (2026-08-17) while auditing an unrelated group setting across a suite of apps: two applications carried exactly that `status !== 404` guard and had therefore **never** created their own role groups on any deployment. Nothing failed loudly — role detection quietly fell back to the site's own Owners/Members groups, so the applications looked fine and the missing groups only showed up when someone went looking for them. If you have this pattern anywhere, the bug is not "sometimes flaky"; it has been 100% broken since the line was written.

## Fix

Treat **only `chk.ok` (200) as "exists"** and **only 400 or 404 as "missing"**. Everything else — 429, 5xx, a dropped connection — means "I don't know", and "I don't know" must not create: `POST /fields` over a column that does exist succeeds and makes a duplicate with a numeric suffix ([`MyField0`](field-created-twice-gets-a-numeric-suffix.md)). Once the check says "missing", let the POST be the source of truth — it returns the definitive result, including a real 403 if the user lacks Manage Lists:

```ts
const chk = await sp.get(`${listUrl}/fields/getbyinternalnameortitle('MyField')?$select=InternalName`);
if (chk.ok) return;                                   // exists — don't duplicate
if (chk.status !== 400 && chk.status !== 404) return; // throttled or failed: unknown → try again next time
// missing (400 ArgumentException) → create; POST decides.
const cr = await sp.post(`${listUrl}/fields`, cfg, { headers, body: JSON.stringify(fieldBody) });
if (!cr.ok) throw new Error(`create failed HTTP ${cr.status}${cr.status === 403 ? ' (no Manage Lists here)' : ''}`);
```

> **Corrected 2026-09-24.** This section used to say "on *any* non-OK status, fall through to the create". That advice produced duplicate columns (`TargetRole0` and three more) the first time the check was throttled — see [A column called `MyField0` appears](field-created-twice-gets-a-numeric-suffix.md) for the three-state check, the second channel for "unknown", and the concurrency guard.

Alternatively, use a **filter query that can't throw** for the probe: `.../fields?$filter=InternalName eq 'MyField'&$select=InternalName` returns an empty collection (HTTP 200) for a miss instead of 400 — cleaner if you want to branch on existence without a POST.

## Why it's easy to miss

- The obvious mental model — "get by name → 404 if not found" — is wrong for this endpoint; it *throws*.
- It only bites when the field is genuinely absent, i.e. the very first run on a fresh list — passes any test where the column already exists.
- A lenient provisioning helper survives it by accident when it only *warns* on a non-404 and still proceeds to the POST; copy the "check, then hard-fail on non-404" shape into new code and it breaks. The lenient shape has its own cost: on the day the check is throttled it proceeds to the POST as well, and the column gets a twin.

## See also

- `gotchas/rest-api/choice-fields-accept-any-value.md` — the POST that follows this check won't validate Choice values.
- `gotchas/rest-api/get-list-by-url-not-by-title.md` — resolve the parent list by URL, not title, for the same idempotence reasons.
