---
title: The 5,000-item list view threshold — and why indexes must come early
tags: [lists, performance, rest-api]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-16
---

# The 5,000-item list view threshold — and why indexes must come early

## Symptom

A list quietly grows past 5,000 items and previously fine queries start failing:

> The attempted operation is prohibited because it exceeds the list view threshold.

Views break, REST queries with `$filter` throw errors — and lowering `$top` doesn't help at all.

## Cause

The threshold is not about how many items you *retrieve* — it's about how many rows the database has to *scan*. A filter or sort on a **non-indexed column** forces a scan of the whole list; once the list holds more than 5,000 items, that operation is rejected no matter how few rows would actually match.

## Fix

1. **Index the columns you filter and sort by** (List settings → Indexed columns) — ideally **before** the list grows large. SharePoint Online manages indexes automatically for lists up to roughly 20,000 items and can usually add a simple index to a large list on demand (asynchronously), but don't make that your plan A. On SharePoint Server, creating an index on a list already over the threshold fails outright.
2. **Filter on an indexed column first** — the first condition of your `$filter` (or view filter) must hit an index.
3. **Page through large result sets** — REST: follow `__next` / `odata.nextLink`; CSOM: `ListItemCollectionPosition`. `$top` caps at 5,000 per page anyway.
4. **Design for it** — keep hot lists lean, archive aggressively, or split data across lists/sites. Lookups, people columns and grouping multiply scan cost.

## Notes

- The item count includes folders, and files in *all* nested folders.
- The REST failure mode is an `SPQueryThrottledException` surfacing as **HTTP 500** — with a defensive data layer that swallows errors, the app just looks permanently empty. (See [silent fallbacks](../rest-api/silent-fallbacks-poison-destructive-writes.md) for why that combination is dangerous.)
- Indexes can be ensured programmatically after provisioning: `GET` the field's `Indexed` flag via `fields/getbyinternalnameortitle('…')?$select=Indexed`, and `MERGE { Indexed: true }` when false — idempotent, safe to re-run. Budget matters: **max 20 indexes per list**, so index only the fields you actually filter on.
- Search-based rollups (KQL against the search index) don't hit the threshold — sometimes search *is* the fix for cross-list dashboards.
- Related script in this repo: [`Get-LargeListsReport.ps1`](../../scripts/lists-and-libraries/Get-LargeListsReport.ps1) — early warning before lists reach the limit.
