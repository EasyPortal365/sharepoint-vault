---
title: File size in a document library — File_x0020_Size 400s; use $expand=File
tags: [rest-api, files, libraries]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
---

# File size in a document library: `File_x0020_Size` 400s — use `$expand=File`

> **Bottom line.** `File_x0020_Size` is a computed column that 400s in `$select` — read the size from the `File` relation instead via `$expand=File` and `File/Length`.
>
> **Ve zkratce.** `File_x0020_Size` je počítaný sloupec, který v `$select` spadne na 400 – velikost čti z relace `File` přes `$expand=File` a `File/Length`.

## Symptom

Listing documents with their size:

```http
GET …/items?$select=Id,FileLeafRef,File_x0020_Size
```

fails with **HTTP 400** — even though `File_x0020_Size` is a perfectly real column you can see in list settings, and the near-identical `File_x0020_Type` selects just fine.

## Cause

`File_x0020_Size` is a **computed column** and computed columns can't be projected through `$select` on the items endpoint. The inconsistency with `File_x0020_Type` (which works) is what makes this one feel like a bug rather than a rule — it costs people an hour of staring at a correct-looking query.

## Fix

Get file facts from the **`File` relation** instead:

```http
GET …/items?$select=Id,FileLeafRef,File/Length,File/UIVersionLabel&$expand=File
```

- **size** → `File/Length` (bytes, as a string — parse before math)
- **version** → `File/UIVersionLabel`
- **name/extension** → `FileLeafRef` (split on the last dot)

## Notes

- If a library query 400s and you recently added *any* field to `$select`, bisect the select list before blaming permissions — a computed or non-queryable column is the usual culprit. A defensive fallback to a minimal `$select` keeps the UI alive.
- `FieldValuesAsHtml` won't rescue you here — file size isn't reliably in it either, and that endpoint has its own escaping quirks. `$expand=File` is the boring answer that works.
