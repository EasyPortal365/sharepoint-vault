---
title: encodeURIComponent won't save you from apostrophes in OData literals
tags: [rest-api, odata, files]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-15
---

# `encodeURIComponent` won't save you from apostrophes in OData literals

## Symptom

REST calls work for months, then fail with **HTTP 400** for *some* inputs:

- uploading `Q1'26 report.xlsx` via `/Files/add(url='…')`
- filtering `$filter=Title eq 'O'Brien'`
- `getbytitle('Team's list')`

The error is a generic bad request or a query-parsing complaint, and the code dutifully calls `encodeURIComponent` on everything.

## Cause

Two different escaping layers are in play, and `encodeURIComponent` only handles one of them:

1. **URL encoding** — what `encodeURIComponent` does. But per its spec it does **not** encode the apostrophe (`'` passes through untouched).
2. **OData string literals** — delimited by apostrophes. An apostrophe *inside* the value must be escaped **by doubling it** (`''`), exactly like in SQL.

So `O'Brien` arrives as `eq 'O'Brien'` — the literal ends after `O`, and the parser chokes on the rest.

## Fix

Escape the OData layer first, then URL-encode:

```ts
const odataString = (s: string): string => s.replace(/'/g, "''");

const name = "Q1'26 report.xlsx";
const url = `${webUrl}/_api/web/GetFolderByServerRelativeUrl('Documents')` +
  `/Files/add(url='${encodeURIComponent(odataString(name))}',overwrite=true)`;

const filter = `$filter=Title eq '${encodeURIComponent(odataString(userInput))}'`;
```

Run `odataString()` on **every** dynamic value that lands between OData quotes: `getbytitle(…)`, `GetList(@u)` parameter aliases, `$filter`, `Files/add(url=…)`, `getFileByServerRelativeUrl(…)`.

## Notes

- This is the classic "works until a customer named O'Brien shows up" bug — test data rarely contains apostrophes; real names, file names and quarter labels do.
- The doubling rule applies to the OData literal only. Don't double apostrophes in JSON request *bodies* — those are plain JSON strings.
