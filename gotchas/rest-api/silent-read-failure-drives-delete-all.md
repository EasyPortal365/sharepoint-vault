---
title: A silently-failed read turns reconciliation into delete-everything
tags: [rest-api, data-loss, error-handling, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-07-29
---

# A silently-failed read turns reconciliation into delete-everything

> **Bottom line.** Any sync that deletes "what is no longer in the source" will delete *everything* the moment the source read fails quietly — an empty array from a throttled request is indistinguishable from an empty source.
>
> **Ve zkratce.** Každá synchronizace, která maže „co už není ve zdroji", smaže **všechno** ve chvíli, kdy čtení zdroje tiše selže – prázdné pole z odmítnutého požadavku je k nerozeznání od prázdného zdroje.

## Symptom

Published files, generated items or mirrored records disappear. No error is shown, logs contain at most a warning, and the operation reports success ("published 0 items"). Re-running the sync recreates them, so it looks like a transient glitch rather than a bug.

## Cause

Two entirely reasonable pieces of code that are fatal in combination.

**1. A paginating helper that gives up quietly:**

```ts
while (url) {
  const resp = await sp.get(url, ...);
  if (!resp.ok) break;          // <-- 429 / 503 / 403 ends the loop
  ...
}
return out;                     // may be []
```

**2. A reconciliation that trusts it:**

```ts
const source = await getAll();                 // [] after a throttled read
const liveIds = new Set(source.map(x => x.id));// empty
for (const file of await listAllFiles()) {
  if (!liveIds.has(file.sourceId)) await remove(file);   // deletes everything
}
```

Three details make it worse:

- **Asymmetric failure.** The two reads run concurrently, so throttling tends to hit the heavier one (the full source listing) while the lighter one succeeds. A complete file list plus an empty source list is exactly the "everything is orphaned" state.
- **Automatic triggers.** Such reconciliation often runs on app open or on a timer, not from a button — so nobody is watching.
- **Caching.** If the empty result is cached, one transient failure is pinned for the whole TTL.

## Fix

Do **not** make the shared pagination helper throw globally — quiet degradation is correct for reads that feed a *view*. Add an opt-in instead:

```ts
export async function fetchAllPages<T>(
  sp: SPHttpClient, url: string, maxItems = 50000, strict = false
): Promise<T[]> {
  ...
  if (!resp.ok) {
    if (strict) throw new Error(`fetchAllPages: HTTP ${resp.status} — ${url}`);
    break;
  }
  ...
}
```

Then use `strict: true` on every path whose result decides what gets deleted, and **bypass the cache** there (a cached empty array from an earlier failure would defeat the whole fix). If the read throws, skip the destructive phase entirely and surface the error.

## The rule worth remembering

For every silent `catch → []` or `if (!ok) break`, ask one question:

> **Does this result decide what gets deleted?**

- **Feeding a view** → fail-safe means *show what you can*. Quiet degradation is right.
- **Feeding a delete** → fail-safe means *do nothing*. Quiet degradation destroys data.

It is the same code property with the opposite correct behaviour. Note this also runs counter to the usual advice of splitting a combined `Promise.all().catch()` into per-source handlers: on a destructive path you *want* one failure to abort the whole operation, because partial data means deleting blindly.

## Verifying a fix

Don't wait for real conditions — manufacture the risky state. Create one record directly via REST so it bypasses the normal creation path, confirm it is in the dangerous state, run the reconciliation, then confirm the outcome and clean up. Waiting for a throttling event to reproduce naturally can take months.
