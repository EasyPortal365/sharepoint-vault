---
title: Two KQL restrictions on the same property separated by a space are OR-ed — a range needs AND
short-title: "`Size>=a Size<=b` returns everything — same-property restrictions are OR-ed"
summary: KQL joins restrictions on the SAME managed property with OR when only a space separates them, so a size or date range written as two restrictions matches every item; write ranges with explicit AND or a..b
tags: [search, kql, paging, range]
applies-to: SharePoint Search REST (/_api/search/query), Query API, KQL
last-reviewed: 2026-10-29
---

# Two KQL restrictions on the same property separated by a space are OR-ed — a range needs AND

> **Bottom line.** In KQL, restrictions on *different* properties separated by a space are AND-ed, but restrictions on the *same* property are OR-ed — `Size>=1048576 Size<=2000000` matches every file, not the range. Write ranges as `(Size>=a AND Size<=b)` or `Size:a..b`.
>
> **Ve zkratce.** V KQL se podmínky na *různé* vlastnosti oddělené mezerou spojí přes AND, ale na *stejnou* vlastnost přes OR – `Size>=1048576 Size<=2000000` vrátí všechny soubory, ne rozmezí. Rozmezí piš jako `(Size>=a AND Size<=b)` nebo `Size:a..b`.

## Symptom

You page through a large result set by value instead of by `startrow` — "files at least
1 MB, largest first, next batch is everything up to the smallest size we've seen" — and
build each query by appending a restriction:

```text
IsDocument:1 Size>=1048576 Size<=2000000
```

The query returns far more rows than expected: every file of 1 MB or more **plus** every
file up to 2 MB. Your continuation never shrinks, and nothing errors. A unit test that only
compares the query string passes, and a live test in a mode without the lower bound
(`IsDocument:1 Size<=2000000`) behaves correctly, so the bug hides until both bounds meet.

## Cause

KQL's implicit operator between restrictions depends on the property:

| Query | Meaning | Rows (measured, 147 docs in scope) |
|---|---|---|
| `Size<=25 Size>=25` | `Size<=25 OR Size>=25` | 147 (everything) |
| `Size>=25 AND Size<=25` | range | 43 |
| `(Size>=25 AND Size<=25)` | range | 43 |
| `Size:25..25` | range | 43 |

Restrictions on different properties (`IsDocument:1 FileExtension:pdf`) are AND-ed, which is
why the habit of "just append another restriction" usually works.

## Fix

- Build the restriction on one property in **one place** and join the bounds with `AND`
  (or use the `a..b` range form):

```js
function sizeClause(min, max) {
  if (max === undefined) return 'Size>=' + min;
  return min === max ? 'Size=' + min : '(Size>=' + min + ' AND Size<=' + max + ')';
}
```

- The same rule (documented in the KQL syntax reference for repeated property restrictions) applies to dates: `LastModifiedTime>=2026-01-01 LastModifiedTime<=2026-06-30`
  is an OR; write `LastModifiedTime:2026-01-01..2026-06-30` or use `AND`.
- Test the query **live in every mode that composes it** and compare row counts, not just
  the string.

## Related trap: a value cursor must handle a value larger than one batch

If you continue with `Size<=smallestSeen` and an entire batch has the same size (more files
of one size than the batch cap), moving the cursor below that size silently skips the rest
of them. Read that one size separately (`Size=X`, paged with `startrow`) before continuing
from `X-1`. A secondary sort on `[DocId]` / `DocId` is rejected by Search REST
("We didn't understand your search terms"), so it can't serve as a tie-breaker.

## See also

- [An unparenthesized `OR` silently escapes your scope filter](kql-or-escapes-your-scope-filter.md)
- [Search queries that actually work](../../guides/search-queries-that-actually-work.md)
