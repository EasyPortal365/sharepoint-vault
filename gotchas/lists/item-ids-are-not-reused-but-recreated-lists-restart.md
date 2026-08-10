---
title: List item IDs are never reused after a purge — but a recreated list starts at 1 again
tags: [lists, rest-api, data-modelling, provisioning]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-10
---

# List item IDs are never reused after a purge — but a recreated list starts at 1 again

> **Bottom line.** Emptying a list does **not** rewind its ID counter: delete every item and the next one still gets the next number. So rows in a *second* list that reference the purged items by ID become dead weight, not silently reattached data. That changes the moment somebody deletes the list itself and lets provisioning recreate it — the new list starts at `1`, and every orphaned reference suddenly points at a real, unrelated item.
>
> **Ve zkratce.** Vyprázdnění listu čítač Id nevynuluje — osiřelé odkazy z jiného listu jsou mrtvá data, ne záměna. Záměna hrozí až když se list smaže a znovu vytvoří: nový začne od 1.

## Symptom

You keep derived data in its own list — read counts, ratings, per-user progress, comments — keyed by the content item's `Id`. A "reset demo content" or "clear all data" routine empties the content list and reseeds it. Afterwards:

- the derived list still holds rows for IDs that no longer exist;
- nothing visibly breaks, because the join simply finds no match;
- so the leftovers survive release after release, and nobody knows whether they are dangerous.

## What actually happens (measured)

Two consecutive purge-and-reseed runs on the same list, 26 items each time:

| Run | IDs before the purge | IDs of the freshly seeded items |
|---|---|---|
| 1 | 1 – 25 | **26 – 51** |
| 2 | 26 – 51 | **52 – 77** |

The counter lives on the list and only ever moves forward. Deleting items — even all of them, even from the recycle bin — does not reset it.

**The exception that matters:** delete the *list* (not its items) and create it again with the same title, and you get a brand-new counter starting at `1`. Provisioning code that recreates missing lists does exactly this, so a "repair the site" action can turn harmless orphans into wrong-item attributions: the old `stats(ItemId = 3)` row now describes a completely different article.

## What to do

1. **Clear the whole graph, not one table.** Write down what references the list by foreign key — statistics, per-user state, attachments, counters, audit rows — and purge it in the same batch. Invalidate their caches too.
2. **Prefer a stable key over `Id`** when the derived data must outlive a rebuild (a GUID column on the content item, or a slug). `Id` is stable for the life of the *list*, not for the life of the *content*.
3. **Do not describe the orphans as an attribution bug** unless you have reproduced a list recreation. The failure mode is real but conditional; overstating it sends people fixing the wrong thing.

## How to verify on your own tenant

```js
// Run in the browser console on the site (F12). Reports which derived rows point nowhere.
const web = _spPageContextInfo.webAbsoluteUrl, rel = _spPageContextInfo.webServerRelativeUrl;
const h = { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' };
const ids = (await (await fetch(`${web}/_api/web/GetList('${rel}/Lists/Articles')/items?$select=Id&$top=5000`, h)).json()).value.map(x => x.Id);
const stats = (await (await fetch(`${web}/_api/web/GetList('${rel}/Lists/ArticleStats')/items?$select=Id,ArticleId&$top=5000`, h)).json()).value;
console.table(stats.filter(s => ids.indexOf(s.ArticleId) === -1));
```

An empty table means the derived list is clean. A non-empty one is not (yet) a data-corruption incident — it is dead weight that becomes one if the parent list is ever recreated.

## Related

- [Reader-written counters belong in their own list](reader-written-counters-belong-in-their-own-list.md) — why the derived list exists in the first place.
- [Seed idempotency must key on the item](seed-idempotency-must-key-on-the-item.md) — the matching trap on the way in.
