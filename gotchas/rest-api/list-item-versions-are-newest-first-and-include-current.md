---
title: List item versions come back newest-first and include the current one – the opposite of file versions
short-title: List item versions are newest-first
summary: "`items(id)/versions` is DESCENDING and its first row is the current version (`IsCurrentVersion: true`) – the opposite of file `/Versions`; `Created` on a version is UTC WITHOUT the `Z`, so `new Date()` shifts it by the browser offset – use `Modified`; `VersionId = major*512 + minor`"
tags: [rest-api, lists, versioning, dates, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-11-10
---

# List item versions come back newest-first and include the current one

> **Bottom line.** The version history of a **list item** (`items(id)/versions`) behaves the opposite way to the history of a **file** (`/Versions`): it is sorted **newest first**, and its **first row is the current version** (`IsCurrentVersion: true`). Code written against one shape silently mislabels the other. And on each item version, `Created` is UTC **without** the trailing `Z` – `new Date()` reads it as local time and shifts every timestamp by the browser's offset. Use `Modified`, which carries the `Z`.
>
> **Ve zkratce.** Historie verzí **položky seznamu** (`items(id)/versions`) se chová opačně než historie **souboru** (`/Versions`): je seřazená **od nejnovější** a **první řádek je aktuální verze** (`IsCurrentVersion: true`). Kód psaný pro jeden tvar ten druhý tiše popíše špatně. A `Created` u verze položky je UTC **bez** koncového `Z` – `new Date()` ho přečte jako místní čas a každý čas posune o posun prohlížeče. Ber `Modified`, ten `Z` má.

## Symptom

A "text history" panel built on list item versions shows the newest edit labelled as the original, or shows the current text twice (once as "current", read from the item, and once as the first history row). Timestamps are one or two hours off – but only in the browser, never in the raw JSON.

## Measured on SharePoint Online (2026-11-10)

An item with ten major versions (current `10.0`), read with `odata=nometadata`:

```http
GET /_api/web/GetList('/sites/team/Lists/Posts')/items(34)/versions
    ?$select=VersionId,VersionLabel,IsCurrentVersion,Modified,Created,Editor
```

| Row | `VersionId` | `VersionLabel` | `IsCurrentVersion` | `Modified` | `Created` |
|---|---|---|---|---|---|
| first | 5120 | `10.0` | `true` | `2026-11-10T12:43:07Z` | `2026-11-10T12:43:07` |
| second | 4608 | `9.0` | `false` | `2026-11-10T12:37:18Z` | `2026-11-10T12:37:18` |
| last | 512 | `1.0` | `false` | `2026-10-29T19:54:23Z` | `2026-10-29T19:54:23` |

- **Descending, current included.** The item itself reports `_UIVersionString = 10.0` – the same as the first row. Compare with file versions, which are ascending and never contain the current version ([file-versions-are-oldest-first](file-versions-are-oldest-first.md)).
- **`$top` keeps the newest end here.** `$top=2` returned `10.0, 9.0`. A cap on item versions drops the *oldest* versions – the original text, which is often exactly what a "what did it say before review" feature needs. Put the cap above the list's major-version limit (500 by default) or omit it.
- **`Created` has no `Z`.** Same instant as `Modified`, but without the UTC designator. `new Date('2026-11-10T12:43:07')` is 12:43 *local* time – in Central Europe an hour off in winter, two in summer.
- **`VersionId` is `major * 512 + minor`** (`10.0` → 5120). It sorts correctly; `VersionLabel` sorted as a string puts `10.0` before `2.0`.
- **`Editor` comes back as `{ LookupId, LookupValue, Email }`** without `$expand`; `LookupValue` is the display name.
- **Custom columns are returned by their internal name** in `$select` (`PostBody`, not the display name) – same as on the item.

## What to do

```js
const url = `${webUrl}/_api/web/GetList('${listUrl}')/items(${id})/versions`
  + `?$select=VersionId,VersionLabel,IsCurrentVersion,Modified,Editor,Title,Body`;

const rows = (await get(url)).value || [];

// Do not trust the order – sort explicitly (works for both item and file shapes).
const oldestFirst = rows.slice().sort((a, b) => a.VersionId - b.VersionId);

const history = oldestFirst.map(v => ({
  label: v.VersionLabel,
  at: v.Modified,                       // has the Z; Created does not
  by: v.Editor && v.Editor.LookupValue,
  isCurrent: v.IsCurrentVersion === true
}));
```

Two more habits that keep a history UI honest:

- **Read without the browser cache right after your own write** – otherwise the newest version you just created is missing from the list (add a cache-busting query parameter or `cache: 'no-store'`).
- **A failed read is not "no history".** Show an error with retry; an empty list means the list has no versioning or the item was never edited – say which.

## How to confirm it on your tenant

```http
GET …/items(<id>)/versions?$select=VersionLabel,IsCurrentVersion,Modified,Created&$top=1
GET …/items(<id>)?$select=OData__UIVersionString
```

If the single row has `IsCurrentVersion: true` and the same label as `OData__UIVersionString`, you are reading the newest end. Compare `Created` and `Modified` on that row to see whether the `Z` is missing.

## Related

- [File versions come back oldest-first](file-versions-are-oldest-first.md) – the opposite order on files, and why `$top` drops the newest ones there.
