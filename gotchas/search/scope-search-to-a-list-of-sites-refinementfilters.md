---
title: Scope SharePoint Search to hundreds or thousands of sites with RefinementFilters — and or() with one value returns nothing
short-title: "`SPSiteUrl:or(\"x\")` returns 0 — scope Search to a site list via postquery RefinementFilters"
summary: To restrict any Search query to an explicit list of site collections, POST to /_api/search/postquery with RefinementFilters SPSiteUrl:or(...) (tested with 3,000 URLs); a single value must use equals() because or() with one value returns zero rows; and LastModifiedTime of an STS_Site row says nothing about activity on the site
tags: [search, kql, refiners, postquery, large-tenant, activity]
applies-to: SharePoint Online Search REST (/_api/search/postquery)
last-reviewed: 2026-11-03
---

# Scope SharePoint Search to hundreds or thousands of sites with RefinementFilters — and or() with one value returns nothing

> **Bottom line.** Restricting a query to a list of sites with `Path:"…" OR Path:"…"` in a GET `querytext` hits the URL length limit after a few dozen sites. POST to `/_api/search/postquery` with `RefinementFilters: ['SPSiteUrl:or("url1","url2",…)']` instead — it worked with 3,000 site URLs. For exactly one site use `SPSiteUrl:equals("url")`: `or()` with a single value silently returns **0 rows**.
>
> **Ve zkratce.** Omezení dotazu na seznam webů přes `Path:"…" OR …` v GET `querytext` narazí na délku URL už u desítek webů. Použij `POST /_api/search/postquery` s `RefinementFilters: ['SPSiteUrl:or("url1","url2",…)']` – funguje i s 3 000 adresami. Pro jediný web `SPSiteUrl:equals("url")`: `or()` s jednou hodnotou tiše vrátí **0 výsledků**.

## Symptom

A governance tool should only evaluate the sites people actually work on (say 200 of
7,000). Every content query — anonymous links, files shared with guests, sensitive content —
must be limited to that list. Building `Path:"https://contoso.sharepoint.com/sites/a" OR …`
into `querytext` fails once the URL gets long, and splitting into many small queries
multiplies the calls and breaks paging and totals.

After switching to refinement filters, a list that happens to contain one site returns no
results at all, while the same site in a two-site list works.

## Cause

`RefinementFilters` is applied server-side after the query, and in the POST body it has no
practical length limit. `SPSiteUrl` is refinable, so `or()` over site URLs works as a scope.
The FQL `or()` operator, however, needs at least two operands — with one it matches nothing
instead of failing.

## Fix

```js
function siteRefinementFilter(urls) {
  const vals = urls.map(u => '"' + u.replace(/"/g, '') + '"');
  return vals.length === 1
    ? 'SPSiteUrl:equals(' + vals[0] + ')'
    : 'SPSiteUrl:or(' + vals.join(',') + ')';
}

const body = {
  request: {
    Querytext: 'ViewableByAnonymousUsers:1 AND IsDocument:1',
    StartRow: 0, RowLimit: 500, TrimDuplicates: false,
    SelectProperties: ['Title', 'Path', 'SPSiteURL'],
    RefinementFilters: [siteRefinementFilter(siteUrls)]
  }
};
await fetch(webUrl + '/_api/search/postquery', {
  method: 'POST',
  headers: {
    Accept: 'application/json;odata=nometadata',
    'Content-Type': 'application/json;odata=nometadata',
    'odata-version': '3.0',
    'X-RequestDigest': digest
  },
  body: JSON.stringify(body)
});
```

To report what lies *outside* the list, run the same query without the filter and
subtract — one extra `RowLimit: 1` call per query (`TotalRows` only).

## Picking the active sites without calling each site

`LastModifiedTime` on a `contentclass:STS_Site` row is the root web's timestamp (often a
settings change), not content activity — don't use it. Signals that come in bulk:

- **Views:** `ViewsRecent` (last 14 days) and `ViewsLastMonths1..3` (monthly buckets) are
  returned on the site row of the inventory query. The current month overlaps the 14-day
  value — take the larger of the two, don't add them.
- **Changed documents per site:** one query
  `IsDocument:1 AND LastModifiedTime>=2026-08-05` with refiner `SPSiteUrl(filter=5000/0/*)`
  gives a count per site collection. The refiner can be truncated — a site missing from a
  truncated list is *unmeasured*, not zero.
- **Usage reports** (Graph `getSharePointSiteUsageDetail`, `getTeamsTeamActivityDetail`,
  beta with `$format=application/json` works from the browser) add last-activity dates; with
  concealed names in the Microsoft 365 admin center nothing can be matched — report that as
  "not available", not as "inactive".

## Notes

- Not verified on a tenant with tens of thousands of sites: the maximum number of
  refiner entries returned, and case sensitivity of `SPSiteUrl` values for sites that are
  not in the search index exactly as you spell them (send URLs as the inventory returned
  them or test both).
