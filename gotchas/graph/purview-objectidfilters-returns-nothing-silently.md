---
title: Purview audit objectIdFilters can return nothing — silently
short-title: Purview audit `objectIdFilters` can return nothing — silently
summary: "Narrowed to one library: 0 records, no error; without the filter 1,000 records, 38 of them for that library — ask for a window, filter by object locally, A/B every server-side filter"
tags: [graph, purview, audit, security]
applies-to: Microsoft Graph Audit Log Query API (security/auditLog/queries)
last-reviewed: 2026-09-24
---

# Purview audit `objectIdFilters` can return nothing — silently

> **Bottom line.** An audit log query narrowed to one library with `objectIdFilters` came back with **zero** records and no error. The same query without the filter returned 1,000 records, 38 of them for that library. Don't narrow by object on the service side: ask for a time window (and operations, if you need them), filter by object in your own code, and prove any server-side filter against a known non-empty answer before you build on it.
>
> **Ve zkratce.** Dotaz do auditního logu zúžený na jednu knihovnu přes `objectIdFilters` vrátil **nula** záznamů a žádnou chybu. Stejný dotaz bez filtru vrátil 1 000 záznamů, z toho 38 k té knihovně. Na objekt nezužuj na straně služby: vyžádej si časové okno (a případně operace), podle objektu filtruj ve vlastním kódu a každý serverový filtr nejdřív ověř proti odpovědi, o které víš, že prázdná není.

## Symptom

```json
POST /security/auditLog/queries
{
  "displayName": "Library activity",
  "filterStartDateTime": "2026-08-01T00:00:00Z",
  "filterEndDateTime": "2026-08-31T23:59:59Z",
  "objectIdFilters": [
    "https://contoso.sharepoint.com/sites/projects/Shared Documents",
    "https://contoso.sharepoint.com/sites/projects/Shared Documents/*"
  ]
}
```

The query completes and its `records` are empty. The library looks quiet.

## Cause

The same query for the same window **without** `objectIdFilters` returned 1,000 records, 38 of which belonged to that library — sharing operations among them. The object filter, at least in the URL-plus-wildcard form above, did not narrow the result; it emptied it, and said nothing. The resource page describes the property only as "the collection of object IDs to filter on"; the create-query page adds that for SharePoint and OneDrive activity it is "the full path name of the file or folder accessed by the user". Nothing documents wildcards or a way to match everything under a library, and a filter that matches nothing looks exactly like a quiet library.

It is the same class of trap as an [unknown managed property in SharePoint Search](../search/unknown-managed-properties-fail-silently.md): a filter that swallows data instead of failing.

## Fix

- Ask for a slice — the time window, plus `operationFilters` or `recordTypeFilters` if you need them — and filter by object locally on each record's `objectId`. As a bonus you can show the ratio: "38 of 1,000 records in this window concern this library".
- When there is too much data, **shorten the window** instead of adding `objectIdFilters`.
- Before building on any server-side filter, A/B it: the same query with and without the filter, against an object you know has activity.

## Notes

- Audit queries are asynchronous and can run for a long time: [Purview Audit Query API is async](purview-audit-query-api-is-async.md).
- [auditLogQuery resource type](https://learn.microsoft.com/en-us/graph/api/resources/security-auditlogquery) and [Create auditLogQuery](https://learn.microsoft.com/en-us/graph/api/security-auditcoreroot-post-auditlogqueries) — the documented filter properties.
