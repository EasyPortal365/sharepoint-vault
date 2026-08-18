---
title: Duplicate trimming hides exactly the file copies you are searching for
tags: [search, kql, rest-api, duplicates, trimduplicates]
applies-to: SharePoint Online (Search REST /_api/search/query, KQL)
last-reviewed: 2026-08-18
---

# Duplicate trimming hides exactly the file copies you are searching for

> **Bottom line.** SharePoint Search collapses results with identical content into a single representative by default (duplicate trimming). If your query's *purpose* is to find copies of a file — `FileName:"report.docx"` across the tenant — the perfect copies are precisely what gets trimmed away: you get one hit and `HTTP 200`, which reads as "no copies exist" when several do. Add `&trimduplicates=false` to any query whose point is finding duplicated content. Leave it on everywhere else, or template copies will flood normal results.
>
> **Ve zkratce.** SharePoint Search standardně slučuje výsledky s identickým obsahem do jednoho zástupce (duplicate trimming). Když je smyslem dotazu najít kopie souboru – `FileName:"report.docx"` napříč tenantem – ořezává přesně ty dokonalé kopie, které hledáte: vrátí jeden zásah a `HTTP 200`, což vypadá jako „žádné kopie nejsou", i když existují. Dotazy, jejichž smyslem je hledat duplicity, potřebují `&trimduplicates=false`. Všude jinde trimming nechte zapnutý, jinak výsledky zaplaví kopie šablon.

## Symptom

You build a "find copies of this file" feature: exact file name, tenant-wide scope, expecting every occurrence back.

```
/_api/search/query?querytext='FileName:"report.docx"'
  &selectproperties='Path,SiteTitle,LastModifiedTime'&rowlimit=50
→ HTTP 200, one row — the file itself
```

Yet you *know* a byte-identical copy sits in another library (you put it there). The copy is missing from the results — not because of permissions, not because of a stale index, but because Search decided the two documents are duplicates and showed you only one.

The trap inverts the feature's logic: **the more perfect the copy, the more likely it is hidden.** A slightly edited copy (different content hash) shows up fine; the untouched duplicate — the one worth flagging — does not.

## Cause

Duplicate trimming is a relevance feature: near-identical documents are collapsed so ten copies of the same template don't fill page one. The similarity is computed from content, not file name, and it is **on by default** in the Search REST API. There is no error, no marker in the response that rows were trimmed — the duplicates simply aren't there.

## Fix

Disable trimming for queries whose purpose is finding duplicated content:

```
/_api/search/query?querytext='FileName:"report.docx"'
  &selectproperties='Path,SiteTitle,LastModifiedTime'
  &rowlimit=50
  &trimduplicates=false
```

(SPFx `SPHttpClient` callers: keep the `odata-version: 3.0` header, or the whole Search call fails with HTTP 500 — a separate gotcha.)

Practical notes for a copy-finder feature:

- Exclude the source document itself by comparing `Path` (decode-normalize both sides before comparing).
- Be honest about the boundaries in the UI: the match is by **file name**, so renamed copies are invisible; security trimming still applies, so users only see copies they can access. Say both — an empty result with these caveats reads very differently from "no copies anywhere".
- `TotalRows` versus returned rows tells you whether the list was cut by `rowlimit` — surface "there were more" instead of pretending completeness.

## Rule

A query that *hunts duplicates* must send `trimduplicates=false`; a query that *serves relevance* must not. Decide per call site — there is no correct global default for both.

## See also

- [Search ignores unknown managed properties — silently](unknown-managed-properties-fail-silently.md) — the same class of silent liar: HTTP 200 with quietly missing data.
- [Compare SharePoint paths decode-first](compare-sharepoint-paths-decode-first.md) — needed when excluding the source document from results.
