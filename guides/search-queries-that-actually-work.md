---
title: Search queries that actually work
tags: [search, kql, rest-api, guide]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# Search queries that actually work

> **Bottom line.** SP Search is the most powerful data source in SharePoint — cross-site and security-trimmed — and the most quietly hostile: it needs one non-negotiable header, KQL that bites, and awareness of the freshness and trimming traps.
>
> **Ve zkratce.** SP Search je nejmocnější zdroj dat v SharePointu – napříč weby a s ořezem podle oprávnění – a zároveň nejzákeřnější: vyžaduje jednu nepominutelnou hlavičku, KQL, které kouše, a znalost pastí kolem aktuálnosti a ořezu výsledků.

SP Search is the most underrated data source in SharePoint — cross-site, security-trimmed, fast — and the most quietly hostile API in the stack. This guide covers the REST endpoint, enough KQL to be dangerous, and the traps between you and useful results.

## 1. The endpoint and its one non-negotiable header

```http
GET {webUrl}/_api/search/query?querytext='…'
```

with — always, no exceptions —

```
odata-version: 3.0
Accept: application/json;odata=nometadata
```

Modern clients default to OData 4 and the search service responds with an opaque **500** — [the single most common search "bug"](../gotchas/rest-api/search-api-needs-odata-version-3.md). `POST /_api/search/postquery` (for long queries) wants the same header.

Results come back deeply nested — the rows live at `PrimaryQueryResult.RelevantResults.Table.Rows[]`, each row a list of `{ Key, Value }` cells. Write yourself a `cell(row, key)` helper on day one.

## 2. KQL that covers 90 % of real needs

| Goal | Query text |
|---|---|
| Full-text | `'contract renewal'` (quoted phrase = exact) |
| By content type of thing | `'contentclass:STS_Site'` (sites), `STS_Web` (subwebs), `STS_ListItem_DocumentLibrary` (documents) |
| Scoped to a path | `'Path:"https://contoso.sharepoint.com/sites/projects*" invoice'` |
| By file type | `'FileType:xlsx budget'` |
| Property comparison | `'LastModifiedTime>=2026-01-01'` |
| Boolean logic | `'(fleet OR vehicles) AND policy'` — operators UPPERCASE |
| Exclusions | `'governance -meeting'` |

Prefix wildcard `term*` works; suffix `*term` doesn't. Property queries need **managed properties** (see §4), not internal field names.

## 3. Selecting, sorting, paging

```
&selectproperties='Title,Path,Author,LastModifiedTime,ViewsLifeTime'
&sortlist='LastModifiedTime:descending'
&rowlimit=50&startrow=0
```

- `rowlimit` caps at **500** per page; page with `startrow`.
- Total is in `TotalRows` — treat it as an *estimate*, it can shift between pages.
- Sorting works only on sortable managed properties — notoriously, [analytics counts sort only by `ViewsLifeTime`](../gotchas/search/viewsx-properties-sort-only-by-viewslifetime.md).
- Deduplication is on by default and silently merges similar documents — add `&trimduplicates=false` when you need every item (inventories, audits).

## 4. Managed properties — where good queries go to die

Search doesn't see your columns; it sees **managed properties** mapped from crawled properties:

- Out of the box, a custom column `ProjectCode` becomes crawled `ows_ProjectCode` — **queryable via a `RefinableString*` alias**, not by its own name. Map it (site collection or tenant search schema → pick a free `RefinableString00`–`199`, add the crawled property as mapping) and query `RefinableString00:PRJ-042`.
- Mapping changes need a **re-crawl** to take effect — on SPO that means waiting (minutes to hours); "reindex site" in site settings nudges it.
- Property names in KQL are case-insensitive; values are not stemmed for `Refinable*` (exact-ish matching).
- Useful **built-in** ones you don't have to map: `ViewableByExternalUsers` / `ViewableByAnonymousUsers` (sharing exposure — [see snippet](../snippets/rest/find-externally-shared-content-search.md)), `GroupId` (the connected Microsoft 365 group's id on `STS_Site` rows — non-empty for group/Team-connected sites, empty for classic/communication sites, so it pairs a site to its group/Team with no extra Graph call; verified live 2026-07-24), `LastModifiedTime` (freshness ranges: `LastModifiedTime<2024-07-01`), `IsDocument`, `contentclass`. All return **strings**.

## 5. The traps, concentrated

1. **Freshness**: the index lags minutes to hours behind writes. Search is for *finding*, not for *reading back what you just wrote* — pair it with REST reads for the hot path.
2. **Security trimming ≠ inventory**: results contain only what the caller can see — great for UX, [wrong for tenant inventories](../gotchas/graph/tenant-wide-enumeration-is-app-only.md).
3. **Path comparisons**: search returns *decoded* `Path` values — [normalize before comparing](../gotchas/search/compare-sharepoint-paths-decode-first.md) with browser-sourced URLs.
4. **Apostrophes in querytext**: the whole `querytext='…'` is an OData literal — [double any `'` inside](../gotchas/rest-api/odata-string-literals-and-apostrophes.md), then URL-encode.
5. **Analytics properties lie a little**: windowed view counts select but don't sort; Graph's site analytics can return 200-with-null. Numbers from search are directional, not accounting-grade.

## 6. A worked example — "recent documents across the tenant, for this user"

```ts
const q = new URLSearchParams({
  querytext: `'contentclass:STS_ListItem_DocumentLibrary'`,
  selectproperties: `'Title,Path,FileType,LastModifiedTime,Author'`,
  sortlist: `'LastModifiedTime:descending'`,
  rowlimit: '25',
  trimduplicates: 'false'
});
const res = await spHttpClient.get(
  `${webUrl}/_api/search/query?${q.toString()}`,
  SPHttpClient.configurations.v1,
  { headers: { 'odata-version': '3.0', 'Accept': 'application/json;odata=nometadata' } }
);
```

Security-trimmed, cross-site, one round trip — the kind of query no list API can answer.

---

*Every claim above earned its place by breaking something first. Corrections welcome — see [CONTRIBUTING](../CONTRIBUTING.md).*
