---
title: File versions come back oldest-first, so $top truncates the newest ones
short-title: File versions come back oldest-first
summary: "`/Versions` is ascending, so `$top` drops the NEWEST ones; sorting the result descending afterwards hides it; `$orderby=ID desc` IS honoured together with `$top` (measured), and the list never contains the current version"
tags: [rest-api, files, versioning, paging, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-11-08
---

# File versions come back oldest-first, so `$top` truncates the newest ones

> **Bottom line.** `/Versions` returns the version history in **ascending** order. Pair that with a `$top` and you silently drop the **newest** versions — the exact ones a "compare with the previous version" or "restore recent" feature needs. Sorting the result descending afterwards hides the damage: the list looks freshly ordered while the recent half never arrived.
>
> **Ve zkratce.** `/Versions` vrací historii **vzestupně**. Když k tomu přidáš `$top`, tiše přijdeš o ty **nejnovější** verze – přesně o ty, kvůli kterým funkce typu „porovnej s předchozí verzí“ existuje. Lokální seřazení sestupně škodu zamaskuje: seznam vypadá čerstvě seřazený, jenže novější polovina nikdy nedorazila.

## Symptom

A version picker shows a plausible, newest-first list — but the entries are from years ago, and the version the user just created is not among them. Files with a short history look perfect, so the bug only reaches you from the one document everybody edits.

```http
GET /_api/web/GetFileByServerRelativeUrl('/sites/team/Shared Documents/Contract.docx')/Versions
    ?$select=VersionLabel,Created,Url&$top=100
```

```js
// looks like a sensible newest-first list…
const hist = data.value
  .map(v => ({ label: v.VersionLabel, created: v.Created }))
  .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
```

With 300 versions on the file, `$top=100` hands you versions 1.0 – 100.0 and the sort merely reverses *those*. Versions 101.0 – 300.0 were never fetched.

## Why

`SP.FileVersionCollection` is enumerated in creation order. `$top` is applied server-side to that ascending sequence, so it keeps the **head** — the oldest entries. Client-side sorting runs on the truncated set and cannot recover what was not sent.

The trap is that both halves of the code look right in review: the query has a sane cap, and the sort is explicitly newest-first.

## What to do

**`$orderby=ID desc` works on SharePoint Online** (measured, see below) – but SharePoint does not reliably fail on a parameter it will not honour, so prove it on your platform with a file that has more versions than your `$top` before relying on it alone (on-premises versions were not measured).

Two things that do hold:

**1. Put the cap above the library's version limit.** The default major-version limit in SharePoint Online is 500, so a `$top` above that covers the whole history of a default-configured library in one request.

**2. Detect the cap and say so.** Whatever number you pick, a library can be configured beyond it. If the response fills the cap exactly, you cannot know which end is missing — admit it rather than presenting a partial list as complete.

```js
const VERSION_TOP = 500;   // above SharePoint's default 500-version limit

// escaped = encodeURIComponent(fileUrl.split("'").join("''")) — the path-based call also reaches names with # or %
const url = `${webUrl}/_api/web/GetFileByServerRelativePath(decodedurl='${escaped}')/Versions`
  + `?$select=VersionLabel,Created,Url,IsCurrentVersion&$top=${VERSION_TOP}`;

const data = await get(url);
const rows = data.value || [];

// Cap reached → the list is incomplete and we do not know which end was cut.
const truncated = rows.length >= VERSION_TOP;

const hist = rows
  .map(v => ({ label: v.VersionLabel, created: v.Created, url: v.Url }))
  .sort((a, b) => (b.created || '').localeCompare(a.created || ''));
```

Then surface `truncated` in the UI. "This file has more than 500 versions — the list is incomplete, check the date on the version you pick" costs one line and turns a wrong answer into a qualified one.

## Measured on SharePoint Online (2026-11-08)

A file with four versions (current `4.0`, three earlier ones), read with different parameters:

| Request | Returned labels |
|---|---|
| `/Versions?$select=ID,VersionLabel` | `1.0, 2.0, 3.0` (ascending) |
| `/Versions?…&$top=1` | `1.0` (the oldest) |
| `/Versions?…&$orderby=ID desc&$top=1` | `3.0` (the newest earlier version) |
| `/Versions?…&$orderby=ID desc&$top=2` | `3.0, 2.0` |

So on SPO `$orderby=ID desc` **is** applied before `$top` – with it, a cap keeps the newest end. Keep the client-side sort and the truncation flag anyway (cheap insurance if the behaviour ever changes), and re-run the same four calls when in doubt.

Three more facts from the same run that trip up version-history UIs:

- **The current version is not in `/Versions`.** Every row has `IsCurrentVersion: false`. Labelling the first row "current" marks an old version. Read the current one from the file itself: `GetFileByServerRelativePath(…)?$select=UIVersionLabel,TimeLastModified,CheckInComment,Length,ModifiedBy/Title&$expand=ModifiedBy`.
- **`Url` is web-relative** (`_vti_history/512/Library/file.png`) and serves the old content directly (200, original content type) – prefix the web path and encode each segment. `CreatedBy` can be expanded (`$expand=CreatedBy`, `CreatedBy/Title`) for the author; `CheckInComment` is the version note.
- **`Versions/RestoreByLabel(versionlabel='1.0')` restores the file content only.** It creates a new current version; the list item fields (Title and custom columns) keep their current values, even when the restored version had them empty. History is not shortened.

## How to confirm it on your tenant

Pick a file with more versions than your cap and compare the first row of the raw response against the current version:

```http
GET …/Versions?$select=VersionLabel,Created&$top=5
GET …/ListItemAllFields?$select=_UIVersionString
```

If `value[0].VersionLabel` is `1.0` (or anything far below `_UIVersionString`), you are reading the oldest end. That one comparison also tells you whether an `$orderby` you added is being honoured or quietly dropped.

## Related

- A cap that is never reported reads as a complete list — the same failure mode as [page-size-cap-reported-as-a-result](page-size-cap-reported-as-a-result.md).
