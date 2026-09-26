---
title: Seed idempotency must key on the item, not the collection
short-title: Seed idempotency must key on the item
summary: A per-SET presence check re-inserts the whole block; lists have no unique constraint, and two app starts at the same moment still race – after inserting, re-read and delete your own copies that are not the oldest
tags: [lists, provisioning, seeding, data-quality, concurrency]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-26
---

# Seed idempotency must key on the item, not the collection

> **Bottom line.** A seeder that asks *"is this whole set already there?"* is idempotent only against its own re-run. The moment the set is created through another path, it inserts the entire block a second time — and a SharePoint list has no unique constraint to stop it. Even a correct per-item check races when the app starts twice at the same moment; after inserting, re-read the list and delete your own copies that are not the oldest.
>
> **Ve zkratce.** Seed, který se ptá „je celá sada už v listu?“, je idempotentní jen vůči vlastnímu opakování. Jakmile sadu založí jiná cesta, nasype celý blok podruhé – a SharePoint list žádnou unikátnost nehlídá. I správná kontrola po položkách se srazí, když se appka spustí dvakrát ve stejnou chvíli; po vložení seznam znovu přečti a smaž své kopie, které nejsou nejstarší.

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

## The third source: two app starts at the same moment

Even a per-item check with a strict read races. The seeder reads, works out what is missing and inserts — and nothing stops a second run from doing the same in the same second: two administrators opening the app right after an update, one person with two tabs, the app open in Teams and in the browser at once. Both runs see the same gap and both fill it. In practice this showed up as a new option, added by a later version, appearing twice — the two rows created one second apart — and, on the same site months earlier, a whole default matrix inserted a second time.

SharePoint offers no lock. A lock made from an ETag on a marker row works, but a run that takes the lock and then fails halfway either leaves it held or has to roll its marker back — you stop the duplicate and make the seed impossible to finish. A simpler fix needs no extra state:

**After inserting, re-read the list and delete your own copies that are not the oldest.**

```ts
const mine: number[] = [];                                   // ids THIS run created
for (const d of missing) {
  const created = await post(itemsUrl, body(d));             // POST /items returns the new item
  mine.push(created.Id);
}
// Fresh read: the same URL was read seconds ago, so bypass the browser cache.
const rows = await getAll(itemsUrl + '&$select=Id,Title,SetName&_=' + Date.now());
const first: Record<string, number> = {};
rows.forEach(r => { const k = r.SetName + '|' + r.Title; if (first[k] === undefined || r.Id < first[k]) first[k] = r.Id; });
const lateOwn = rows.filter(r => mine.indexOf(r.Id) !== -1 && r.Id !== first[r.SetName + '|' + r.Title]);
for (const r of lateOwn) await remove(itemUrl(r.Id));        // best-effort
```

Why it converges: each run reads only after all of its own inserts, so for every key it sees the row of whoever inserted earlier. The run that inserted later deletes its copy; the earlier run finds nothing of its own to delete. Both pick the same winner — the lowest `Id` — so exactly one row stays, and rows created by anyone else are never touched, including duplicates an administrator made by hand.

- Delete only ids from **your own** POST responses. "Delete every copy that is not the oldest" makes both runs delete each other's rows.
- The re-read must bypass the browser cache (a unique query parameter). The list URL was read seconds earlier, and a cached "before" answer hides the twin.
- Keep the delete best-effort: if it fails, you are back to a duplicate, not to something worse.
- Test the interleavings: the later run deletes and the earlier one does not; a run that cannot see the other run's later copy yet deletes nothing (its author will); a whole block inserted twice, interleaved, ends with every key once; and a counterexample showing that without the "own" condition a run would delete a foreign row.

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

- Check-then-insert without a lock races and produces duplicate rows; the same list has no unique constraint to fall back on. The lock-free cleanup of your own late copies above is the fix that does not need one.
- Provisioning does not reconcile schema changes on existing fields — the same "it ran once, it must be fine" assumption in a different place.
