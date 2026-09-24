---
title: encodeURIComponent won't save you from apostrophes in OData literals
tags: [rest-api, odata, files]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# `encodeURIComponent` won't save you from apostrophes in OData literals

> **Bottom line.** `encodeURIComponent` doesn't escape the apostrophe, so an apostrophe inside an OData literal must be doubled (`''`) first — otherwise names like O'Brien and labels like Q1'26 400 the request.
>
> **Ve zkratce.** `encodeURIComponent` apostrof neescapuje, takže apostrof uvnitř OData literálu musíš nejdřív zdvojit (`''`) – jinak jména jako O'Brien a označení jako Q1'26 shodí požadavek na 400.

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

const folderUrl = '/sites/projects/Shared Documents';
const name = "Q1'26 report.xlsx";
const url = `${webUrl}/_api/web/GetFolderByServerRelativePath(decodedurl='${encodeURIComponent(odataString(folderUrl))}')` +
  `/Files/AddUsingPath(DecodedUrl='${encodeURIComponent(odataString(name))}',Overwrite=true)`;

const filter = `$filter=Title eq '${encodeURIComponent(odataString(userInput))}'`;
```

Run `odataString()` on **every** dynamic value that lands between OData quotes: `getbytitle(…)`, `GetList(@u)` parameter aliases, `$filter`, `GetFileByServerRelativePath(decodedurl=…)`, `GetFolderByServerRelativePath(decodedurl=…)`, `…UsingPath(DecodedUrl=…)`, `sitegroups/getbyname(…)`, and `AttachmentFiles/getByFileName(…)`. A convenient wrapper that does both layers at once: `const spLit = (p) => encodeURIComponent(p.replace(/'/g, "''"));`.

For file and folder paths, use the ResourcePath calls shown above rather than `Files/add(url=…)`, `GetFileByServerRelativeUrl(…)` or `GetFolderByServerRelativeUrl(…)`: with a `#` or `%` in the name the classic calls cannot find the item even when the path is encoded, and `Files/add` with an encoded `%` saves the file under a name containing a literal `%25` — [A `#` or `%` in a file or folder name](hash-and-percent-in-file-names-need-the-resourcepath-api.md).

## Notes

- This is the classic "works until a customer named O'Brien shows up" bug — test data rarely contains apostrophes; real names, file names and quarter labels do.
- The doubling rule applies to the OData literal only. Don't double apostrophes in JSON request *bodies* — those are plain JSON strings.
- The opposite mistake — doubling the apostrophes but skipping `encodeURIComponent` — breaks on `#`, which starts the URL fragment and cuts the query off. Guest UPNs (`#EXT#`) always contain one: [An unencoded `#` in a `$filter` value cuts the URL](unencoded-hash-in-a-filter-value-cuts-the-url.md).
