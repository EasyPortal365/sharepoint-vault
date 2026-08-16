---
title: File versions come back oldest-first, so $top truncates the newest ones
tags: [rest-api, files, versioning, paging, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-16
---

# File versions come back oldest-first, so `$top` truncates the newest ones

> **Bottom line.** `/Versions` returns the version history in **ascending** order. Pair that with a `$top` and you silently drop the **newest** versions — the exact ones a "compare with the previous version" or "restore recent" feature needs. Sorting the result descending afterwards hides the damage: the list looks freshly ordered while the recent half never arrived.
>
> **Ve zkratce.** `/Versions` vrací historii **vzestupně**. Když k tomu přidáš `$top`, tiše přijdeš o ty **nejnovější** verze – přesně o ty, kvůli kterým funkce typu „porovnej s předchozí verzí" existuje. Lokální seřazení sestupně škodu zamaskuje: seznam vypadá čerstvě seřazený, jenže novější polovina nikdy nedorazila.

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

**Do not reach for `$orderby` as the fix.** Ordering support on this collection is not something to assume, and SharePoint does not reliably fail on a parameter it will not honour — a silently ignored `$orderby` leaves you with the same wrong data and a false sense of having fixed it. If you want to use it, prove it works on a file with more versions than your `$top` before trusting it.

Two things that do hold:

**1. Put the cap above the library's version limit.** The default major-version limit in SharePoint Online is 500, so a `$top` above that covers the whole history of a default-configured library in one request.

**2. Detect the cap and say so.** Whatever number you pick, a library can be configured beyond it. If the response fills the cap exactly, you cannot know which end is missing — admit it rather than presenting a partial list as complete.

```js
const VERSION_TOP = 500;   // above SharePoint's default 500-version limit

const url = `${webUrl}/_api/web/GetFileByServerRelativeUrl('${escaped}')/Versions`
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

## How to confirm it on your tenant

Pick a file with more versions than your cap and compare the first row of the raw response against the current version:

```http
GET …/Versions?$select=VersionLabel,Created&$top=5
GET …/ListItemAllFields?$select=_UIVersionString
```

If `value[0].VersionLabel` is `1.0` (or anything far below `_UIVersionString`), you are reading the oldest end. That one comparison also tells you whether an `$orderby` you added is being honoured or quietly dropped.

## Related

- A cap that is never reported reads as a complete list — the same failure mode as [page-size-cap-reported-as-a-result](page-size-cap-reported-as-a-result.md).
