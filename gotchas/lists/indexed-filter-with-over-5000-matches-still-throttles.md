---
title: "An index is not enough: an equality filter on an indexed column with more than 5,000 matches still throws `SPQueryThrottledException`"
short-title: "Indexed filter with > 5,000 matches still throttles"
summary: "Paging and a small `$top` don't help; read a growing list in `Id` windows of 5,000 — measured A/B on a 5,100-item list"
tags: [lists, rest-api, performance, threshold, indexes]
applies-to: SharePoint Online REST (`/items?$filter=…`), tested from the browser with `odata=nometadata`
last-reviewed: 2026-11-21
---

# An index is not enough: an equality filter on an indexed column with more than 5,000 matches still throws `SPQueryThrottledException`

> **Bottom line.** An index only helps when its condition narrows the result below the threshold. `$filter=Type eq 'published'` on an **indexed** column fails with HTTP 500 once more than 5,000 items match — with `$top=5000`, with `$top=1000`, with paging. A range on `Id` always fits: read growing lists in windows `Id gt a and Id le a+5000 and (your condition)`.
>
> **Ve zkratce.** Index pomůže, jen když jeho podmínka zúží výsledek pod práh. `$filter=Type eq 'published'` na **indexovaném** sloupci spadne na HTTP 500, jakmile mu odpovídá víc než 5 000 položek – s `$top=5000`, s `$top=1000` i se stránkováním. Rozsah na `Id` se vejde vždy: rostoucí seznam čti po oknech `Id gt a and Id le a+5000 and (podmínka)`.

## Symptom

A log-style list (event type, status, year…) has the filtered column indexed from day one. Queries work for months, then start failing with:

```
HTTP 500  -2147024860, Microsoft.SharePoint.SPQueryThrottledException
The attempted operation is prohibited because it exceeds the list view threshold.
```

The general threshold article ([The 5,000-item view threshold](list-view-threshold-and-indexes.md)) says "index the column" — and the column *is* indexed.

## Measured (list of 5,100 items, `Title` indexed while the list was empty, 5,050 items with `Title = 'same'`)

| `$filter` | `$top` | Result |
|---|---|---|
| `Title eq 'same'` | 5000 | **500** throttled |
| `Title eq 'same'` | 1000 | **500** throttled |
| `Title eq 'same' or Title eq 'other-5051'` | 5000 | **500** throttled |
| `Title eq 'other-5060'` (1 match) | 5000 | 200 |
| `Id ge 1 and Id lt 5001 and Title eq 'same'` | 5000 | 200, 5,000 rows |
| `Id ge 1 and Id lt 5001 and (Title eq 'same' or Title eq 'other-5051')` | 5000 | 200 |
| `Title eq 'same' and Id ge 1 and Id lt 5001` (order swapped) | 5000 | 200 |
| no filter, `$orderby=Id asc` | 5000 + `odata.nextLink` | 200, 2 pages |

Whole list read in two `Id` windows with the `or` condition: 5,051 rows, 829 ms.

## Fix

```js
// 1) highest Id
const last = await get(items + '?$select=Id&$orderby=Id desc&$top=1');
const maxId = last.value.length ? last.value[0].Id : 0;
// 2) windows of 5,000 Ids – each scans at most 5,000 rows
for (let a = 0; a < maxId; a += 5000) {
  const b = Math.min(a + 5000, maxId);
  const f = `Id gt ${a} and Id le ${b} and (Type eq 'published' or Type eq 'migrated')`;
  rows.push(...await getAllPages(items + '?$select=…&$filter=' + encodeURIComponent(f) + '&$orderby=Id asc&$top=5000'));
}
```

- Keep equality filters on indexes only where the number of matches is small *by nature* (a document key, an item id, the assignee of an open task).
- Read the windows in small batches (3–5 in parallel) and treat a failed window as a failed read — never return a partial result as complete.
- Test with a temporary list and fill it with `$batch` (100 items per request). Thousands of single POSTs in parallel run into HTTP 429 and throttle the account on that site for minutes — reads included.
