---
title: Seed idempotency must key on the item, not the collection
tags: [lists, provisioning, seeding, data-quality]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-29
---

# Seed idempotency must key on the item, not the collection

> **Bottom line.** A seeder that asks *"is this whole set already there?"* is idempotent only against its own re-run. The moment the set is created through another path, it inserts the entire block a second time — and a SharePoint list has no unique constraint to stop it.
>
> **Ve zkratce.** Seed, který se ptá „je celá sada už v listu?", je idempotentní jen vůči vlastnímu opakování. Jakmile sadu založí jiná cesta, nasype celý blok podruhé – a SharePoint list žádnou unikátnost nehlídá.

## Symptom

Every option in the app's UI appears **twice**: duplicated filter chips, dropdowns listing each choice two times, two identical status pills. Records themselves look fine — nothing points at a missing or unknown value.

It reads like a rendering bug (a `map` without `key`, a component mounted twice), so the search starts in the front-end. It isn't there.

## Cause

The lookup list that backs those options holds each key twice. A typical seeder looks like this:

```ts
const existing = await getChoices();            // may be [] on a fresh site
const present: Record<string, boolean> = {};
existing.forEach(c => { present[c.SetName] = true; });        // ← per SET
const missing = DEFAULTS.filter(d => !present[d.set]);        // ← per SET
await Promise.all(missing.map(insert));
```

The presence test is per **set** (`"ContactSource"`), not per **item** (`"ContactSource|LinkedIn"`). That is fine while one code path owns the list. It stops being fine when:

- a second user runs the app with a different client-side marker / version,
- an older build without the version marker touches the site,
- someone imports the defaults manually.

Then the set-level check passes for the sets that exist, and re-inserts the **whole block** for the one being (re)created. In a real tenant this produced 201 items where 106 belonged: **95 keys duplicated**, the two copies identical in label and colour, differing only in their sort order, created a month apart by different authors.

## Fix

**1. Key the check on the item.**

```ts
const present: Record<string, boolean> = {};
existing.forEach(c => { present[c.SetName + '|' + c.Key] = true; });
const missing = DEFAULTS.filter(d => !present[d.set + '|' + d.value]);
```

The set-level check can stay as a cheap pre-filter — just never as the guarantee.

**2. Ship a cleanup tool inside the app**, because duplicates will already exist on deployed sites. Group by `set|key`, keep the **oldest** row, delete the copies:

- "Lowest Id" is *not* a synonym for "the right version" — an older row can be the stale one. Compare the payload too.
- If the copies **differ** in label, colour or any displayed attribute, do **not** delete: report them and let an admin decide. Silent merge loses an edit someone made.
- Show the count first ("found 95 duplicated values"), delete on a second explicit click, and report what was removed.

**3. Invalidate the cache after cleanup.** Apps typically read lookup lists once at start-up and cache them (`localStorage`, memory). After a successful cleanup the rest of the UI keeps showing the duplicates until a reload — which looks exactly like "the cleanup did nothing". Rewrite the cache and tell the user to refresh.

## The second source: a seed decided from a read that was never verified

Same outcome, different trigger — and this one fires on healthy code that simply swallowed an error:

```ts
let rows = [];
try { rows = await getChoices(); } catch (e) { console.warn(e); }   // ← failure becomes []
if (!rows.length) await seedDefaults();                             // ← "empty", so seed
```

A throttled request (`429`), a transient `5xx`, or a list the current user cannot fully read (see item-level permissions) all arrive here as an empty array, and the seeder happily inserts the whole set again. **"The read failed" and "there is nothing there" must not collapse into the same value** when the next line performs a write — carry an explicit `readOk` flag and seed only after a proven successful read.

Better still: **keep seeding out of the read path entirely.** A settings button ("create default values") is the honest place for it. On a fresh site, fall back to the built-in values *in memory* — the UI works, nothing is written, and an admin decides when the list gets populated. Auto-seeding on read also races: two users opening a brand-new site at the same moment both see "empty" and both insert.

## Diagnostic shortcut

Before opening a single component file, count the keys in the data:

```js
const rows = (await (await fetch(
  "<site>/_api/web/GetList('<server-relative-list-url>')/items?$select=Id,Title,SetName&$top=500",
  { headers: { Accept: 'application/json;odata=nometadata' } })).json()).value;
const seen = {};
rows.forEach(r => { const k = r.SetName + '|' + r.Title; seen[k] = (seen[k] || 0) + 1; });
console.log('items', rows.length, 'duplicated keys', Object.keys(seen).filter(k => seen[k] > 1).length);
```

One request separates a data duplication from a rendering bug — and it points straight at the seeder.

## Related

- Check-then-insert without a lock races and produces duplicate rows; the same list has no unique constraint to fall back on.
- Provisioning does not reconcile schema changes on existing fields — the same "it ran once, it must be fine" assumption in a different place.
