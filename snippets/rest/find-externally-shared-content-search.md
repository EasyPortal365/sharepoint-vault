---
title: Find externally / anonymously shared content via Search
tags: [rest-api, search, security, oversharing, kql]
applies-to: SharePoint Online
last-reviewed: 2026-07-23
---

# Find externally / anonymously shared content via Search

> **Bottom line.** `ViewableByExternalUsers` and `ViewableByAnonymousUsers` are **built-in, queryable, retrievable** managed properties. A one-line Search query surfaces every file the current user can see that is shared out — no crawl config, no Graph, security-trimmed to the caller. Values come back as the **strings `"true"`/`"false"`**, not booleans.

## Why

For an oversharing / Copilot-readiness audit you want the *files* exposed outside the org, not just the tenant sharing toggle. Search already computes this per item — you just have to ask, and it runs same-origin under the signed-in admin's token.

## Query

```
GET {web}/_api/search/query
    ?querytext='ViewableByExternalUsers:1 AND IsDocument:1'
    &selectproperties='Title,Path,SiteTitle,ViewableByExternalUsers,ViewableByAnonymousUsers,LastModifiedTime'
    &rowlimit=500
    &trimduplicates=false
Headers: Accept: application/json;odata=nometadata   |   odata-version: 3.0
```

- `ViewableByExternalUsers:1` → items reachable by guests. `ViewableByAnonymousUsers:1` → items behind "Anyone" links (the scary ones).
- **`AND IsDocument:1`** — without it the query also returns *sites* whose sharing is external (the Path is a web root, not a file); add it when you want files only.
- **`trimduplicates=false`** — an audit must count every copy; dedup silently hides some (see the search guide).
- **`odata-version: 3.0`** header is mandatory for Search REST or you get mysterious 500s (see the [search odata-version gotcha](../../gotchas/rest-api/search-api-needs-odata-version-3.md)).
- Total count is `PrimaryQueryResult.RelevantResults.TotalRows`; per-row values are in `...Table.Rows[i].Cells` as `{Key, Value}` pairs.

## Traps

- **Values are strings.** A cell comes back `"true"` / `"false"`, never `1`/`0` — compare `cell.Value === 'true'`, not truthiness of `"false"` (which is truthy!).
- **Security-trimmed to the caller.** You see what the signed-in user sees. As a Global/SharePoint admin that's effectively tenant-wide, but a lesser account under-reports — the empty result is "nothing *you* can see", not "nothing exists".
- **Sites vs files.** As above — `ViewableByExternalUsers:1` alone mixes both; filter by `IsDocument:1` (files) or `contentclass:STS_Site` (sites) depending on what you're auditing.
- **Anonymous = 0 is common and good.** Most tenants restrict sharing to guests, so `ViewableByAnonymousUsers:1` returns nothing; that's a healthy signal, not a broken query.
