---
title: "A page-size cap reported as a finding"
tags: [rest-api, graph, reporting, paging, powershell]
applies-to: SharePoint Online, Microsoft Graph, any paged REST API
last-reviewed: 2026-08-24
---

# A page-size cap reported as a finding

> **Bottom line.** When a report says "100 commits", "500 external users" or "5,000 items", check the API's page size before you believe it — a single unpaged request returns exactly the cap, and code that sums what it received presents the limit of the tool as a measurement of the world.
>
> **Ve zkratce.** Když report tvrdí „100 commitů", „500 externích uživatelů" nebo „5 000 položek", ověř si velikost stránky API dřív, než tomu uvěříš – jeden nestránkovaný požadavek vrátí přesně strop a kód, který sečte, co dostal, vydá mez nástroje za změřenou skutečnost.

## Symptom

A dashboard reports repository activity as:

```text
▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▆█▃  100 commits / 52 weeks
```

The repository actually has 151. The number is not slightly wrong, and it is not drifting — it is pinned to a round figure and stays there while real commits keep landing.

The same shape shows up all over administration work:

- a guest inventory that always ends at exactly **500** external users
- a list report that finds exactly **5,000** items in a library holding 40,000
- a group membership audit that stops at **999** members
- a Graph query that returns exactly **100** messages

Nothing errors. Every call returns HTTP 200.

## Cause

Paged APIs answer with one page and tell you, in a place that is easy to ignore, that more exists:

| API | Default / cap per request | "There is more" lives in |
|---|---|---|
| SharePoint REST items | 100 default, **5,000 max** for `$top` | `odata.nextLink` |
| Microsoft Graph | 100 default (varies), often 999 max | `@odata.nextLink` |
| GitHub REST | 30 default, **100 max** for `per_page` | `Link` header, `rel="next"` / `rel="last"` |
| `Get-SPOExternalUser` | **50 max** for `-PageSize` | nothing — you page by `-Position` |

Code that fetches one page and reduces it — `.length`, a sum, a `Measure-Object` — produces a number that describes the request, not the tenant. Two things then make it durable:

1. **The value looks plausible.** 100 commits for an active repo, 500 guests for a mid-size tenant. Nobody questions it.
2. **It gets cached.** In the case above the figure went into a 30-minute `localStorage` cache, so the wrong number survived long after the underlying data source was ready to answer correctly.

This is the same family as [silent read failure drives delete-all](silent-read-failure-drives-delete-all.md): a technical limit quietly becomes a statement about reality.

## Fix

**Ask for the count instead of counting what arrived.** Most APIs will tell you the total without shipping every row.

GitHub — the last page number at `per_page=1` *is* the number of commits:

```javascript
const res  = await fetch(base + '/commits?per_page=1');
const link = res.headers.get('Link') || '';
const m    = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
const total = m ? parseInt(m[1], 10) : null;   // null = unknown, NOT zero
```

Microsoft Graph — ask for the count explicitly (needs the `ConsistencyLevel: eventual` header on directory objects):

```http
GET /groups/{id}/members/$count
GET /users?$count=true&$top=1        → "@odata.count": 4213
```

SharePoint REST — for a whole list, read `ItemCount` rather than counting items; for a filtered set, follow the links:

```http
GET /_api/web/lists/GetById('...')?$select=ItemCount
```

**When you must page, page to exhaustion and say so if you stop.**

```powershell
$all = @()
$position = 0
do {
    $page = @(Get-SPOExternalUser -Position $position -PageSize 50)
    $all += $page
    $position += $page.Count
} while ($page.Count -eq 50)      # a short page means the end
```

**Treat a result equal to the cap as suspicious, in code.** This costs three lines and turns a silent wrong answer into a visible question:

```powershell
if ($result.Count -eq $pageSize) {
    Write-Warning ("Got exactly {0} rows - the page size. This is probably a truncated result, not a total." -f $pageSize)
}
```

**And when the total genuinely cannot be determined, label the number as a floor** — `at least 100 commits` — rather than presenting it as a total.

## Notes

- **Round numbers are the tell.** 30, 50, 100, 200, 500, 999, 1000, 5000. Any of them landing exactly on a report line deserves one check before it reaches a customer.
- The cap is not always the documented one. `Get-SPOExternalUser` caps `-PageSize` at 50, but its tenant-wide scope has also been observed to stop producing results well before the real guest count — so "I paged correctly" is not the same as "I got everything".
- A number pinned to the cap and a number that is genuinely at the cap look identical. If your data legitimately sits near a round figure, fetch one extra page to prove it ends there.
- Related, on getting the paging itself right: [Read all items from a large list — paging done right](../../snippets/rest/get-all-list-items-paged.md).
- Related, the reverse direction — a limit that hides work instead of inventing it: [Search ignores unknown managed properties](../search/unknown-managed-properties-fail-silently.md).
