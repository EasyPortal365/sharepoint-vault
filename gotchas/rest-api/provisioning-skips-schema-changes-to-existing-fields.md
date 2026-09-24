---
title: A new Choice value in your provisioning code never reaches already-deployed sites
short-title: Provisioning skips schema changes to existing fields
summary: Create-if-missing never updates an existing field; a new Choice value in the manifest no-ops on deployed sites; reconcile with a post-hook `SP.FieldChoice` MERGE (plain JSON with `@odata.type` under `SPHttpClient`) that only ever widens the set — `Choices` is replace, so a failed read of the current values turns the union into the manifest and deletes the rest, while items keep the values the definition no longer knows
tags: [rest-api, fields, provisioning]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# A new Choice value in your provisioning code never reaches already-deployed sites

> **Bottom line.** Idempotent "create the field if it's missing" provisioning never *updates* a field that already exists — so a new Choice value (or any schema change) you add to the manifest silently no-ops on every site that already had the field. Reconcile existing fields with a targeted post-provisioning MERGE — under `SPHttpClient` a plain JSON body with `'@odata.type': '#SP.FieldChoice'`, not the verbose `__metadata` form, which 400s there.
>
> **Ve zkratce.** Idempotentní provisioning „vytvoř pole, když chybí“ už existující pole nikdy neaktualizuje – nová hodnota Choice (nebo jakákoli změna schématu) přidaná do manifestu se na webech, kde pole už bylo, tiše přeskočí. Existující pole dorovnej cíleným post-provisioning MERGE – pod `SPHttpClient` prostým JSON s `'@odata.type': '#SP.FieldChoice'`, ne verbose tvarem s `__metadata`, který tam končí na 400.

## Symptom

You extend a Choice field's allowed values in your declarative provisioning — you add `Scheduled` to a `DocStatus` field — bump the schema version, and redeploy.

- **Brand-new sites are fine:** the field is created from the manifest, `Scheduled` included.
- **Sites that already had the field are broken:** the new value simply isn't there. Your app's forms and pickers don't offer it and dashboards can't group by it. Writing the new value, on the other hand, still *succeeds* — REST does not validate Choice values ([measured](choice-fields-accept-any-value.md)) — so no error ever points you at the stale definition. (An earlier version of this article said the write fails with HTTP 400. A live test on 2026-09-24 showed 201.)

The manifest clearly lists the value; the deployed field disagrees. It looks like a deployment or seeding bug, but the code and the manifest are both correct.

## Cause

Provisioning frameworks make field creation idempotent with an **existence check**:

```http
GET /_api/web/lists/getbytitle('Documents')/fields/getbyinternalnameortitle('DocStatus')
```

If the field exists, the `POST /fields` is **skipped**. That skip is *correct* — re-POSTing an existing field creates a duplicate with an auto-suffixed InternalName (`DocStatus0`, `DocStatus1`). But the consequence is that the manifest is applied only at **first create**. Any later change to an *existing* field's definition — new `Choices`, a type change, a formula, a `Required` toggle — is never reconciled.

Bumping a "schema version" gate doesn't help either: it re-runs provisioning, but provisioning still won't touch a field that already exists.

## Fix

Add a targeted **post-provisioning migration** that reconciles just the field you changed. Read the current choices, and if the new value is missing, MERGE the field. Under `SPHttpClient` the MERGE is plain JSON in the OData v4 shape — a verbose body with `__metadata` fails there with HTTP 400, because the client sends `odata-version: 4.0` ([Drop `__metadata` from write bodies](metadata-body-requires-verbose.md)):

```ts
// 1) read current choices
//    nometadata -> Choices is a plain array; verbose -> { results: [...] }. Handle both.
const url = `${web}/_api/web/lists/getbytitle('Documents')/fields/getbyinternalnameortitle('DocStatus')`;
const res = await sp.get(`${url}?$select=Choices`, cfg, { headers: { Accept: 'application/json;odata=nometadata' } });
if (!res.ok) return;                                             // MUST NOT continue: see "widen only" below
const raw = (await res.json()).Choices;
const current: string[] = Array.isArray(raw) ? raw : (raw && raw.results) || [];
if (current.indexOf('Scheduled') !== -1) return;                 // already there — no-op

// 2) send the FULL canonical list back as a MERGE (Choices is replace, not append)
const desired = ['Draft', 'PendingApproval', 'Scheduled', 'Published', 'Archived'];
current.forEach(c => { if (desired.indexOf(c) === -1) desired.push(c); }); // keep unknown legacy values
await sp.post(url, cfg, {
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-HTTP-Method': 'MERGE',
    'IF-MATCH': '*'
  },
  body: JSON.stringify({ '@odata.type': '#SP.FieldChoice', Choices: desired })   // a plain array in v4
});
```

Key points:

- **`Choices` is replace, not append** — send the complete, canonically ordered list, and preserve any unknown existing values by appending them at the end.
- **Make it idempotent** — bail out when the value is already present, so it costs a single GET on every subsequent load.
- **Make it fail-safe** — a normal user without `ManageLists` can't PATCH a field definition. Catch and warn; never let it abort provisioning. The first admin who opens the app reconciles the field for everyone.
- **Run it *after* your normal provisioning pass**, not instead of it.

## The reconcile widens, never narrows — and a failed read is not an empty vocabulary

Both halves of that sentence are load-bearing, and they fail together.

**Widen only.** `Choices` replaces the whole set, so the reconcile is a *union* of the manifest and what the field already holds. It is tempting to make it an assignment instead — "the manifest is the truth, write exactly that" — and on a fresh site it behaves identically. On a deployed site it is destructive in a way SharePoint will not warn you about: **items already carry the values you are removing.** Nothing is deleted from the items; the stored value simply stops being part of the field's vocabulary. The result is a column whose contents are no longer valid according to its own definition:

- forms show the item's current value as out of range and refuse to save an unrelated edit to that item;
- group-by and filters offer a set that does not cover the data;
- a `$filter` on the retired value still matches rows that the picker can no longer produce.

If a value must go out of use, retire it in the UI (stop offering it, migrate the items, then remove it) — not by shrinking the definition underneath live data.

**A failed read collapses the union into the manifest.** That makes the strict read above more than hygiene. Reading the current `Choices` fails for perfectly ordinary reasons — a member without `ManageLists` gets `403`, a busy tenant returns `429`, and a missing field answers with HTTP **400**, not 404 ([`fields/getbyinternalnameortitle` 400s for a missing field](getbyinternalnameortitle-400-not-404.md)). A helper that resolves any of those to `[]` produces an empty "current" set, and:

```
desired = manifest ∪ current   →   manifest ∪ ∅   →   manifest
```

The MERGE then goes through with full authority and **deletes every value the manifest does not know about** — including the ones an older release added and the ones a customer added by hand. The call returns `204`, the log says "reconciled", and the damage is only visible in the field's definition.

So: check `res.ok` (and the parsed shape) before computing the union, and treat "could not read the current choices" as a reason to do nothing this run. An unknown current state is never a licence to write an authoritative one.

## Notes

- The same pattern fixes any existing-field schema drift: a `Required` toggle, a new calculated formula, an added lookup — the create-if-missing step won't apply them, a post-hook MERGE will.
- The `@odata.type` must match the field — `#SP.FieldChoice` for a Choice column, `#SP.FieldMultiChoice` for a multi-choice one. The wrong type 400s.
- The annotation needs the `OData-Version: 4.0` header, which `SPHttpClient` adds by default; the `Content-Type` may be `application/json` or `…;odata=nometadata` (live A/B, 2026-09-24). Without the header — a bare `fetch` — the server answers *"'@odata.type' is an invalid instance annotation name"* ([`POST /views` takes an `SP.View` body](creating-a-view-posts-sp-view-not-viewcreationinformation.md)).
- An earlier version of this article sent the MERGE as `odata=verbose` with `__metadata` and `Choices: { results: [...] }`. Through `SPHttpClient` that body fails with HTTP 400, and a fail-safe reconcile that only warns never succeeds even once — in our case it went unnoticed for about a year, until an unrelated audit found it.
- Related trap, same root: [Choice fields accept any value over REST](choice-fields-accept-any-value.md). The two compound — a raw write slips the unknown value through, while the field on already-deployed sites still lacks it in its *definition*, so forms won't offer it and group-bys ignore it. Keep the field definition and your app's vocabulary in lockstep, and check it at build time: [A Choice value your field does not know is stored anyway](../lists/choice-value-missing-from-the-field-is-stored-anyway.md).
- Don't "fix" it by deleting and recreating the field — that destroys every value already stored in the column. Reconcile in place.
