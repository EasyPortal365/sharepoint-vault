---
title: A folder's Files collection rejects a two-level $expand
short-title: A folder's `Files` collection rejects a two-level `$expand`
summary: "`ListItemAllFields/Editor` 400s there; take `ModifiedBy`/`Author` from the file, and list one level through the folder API rather than a `FileDirRef` filter"
tags: [rest-api, files, folders, expand]
applies-to: SharePoint Online
last-reviewed: 2026-09-24
---

# A folder's `Files` collection rejects a two-level `$expand`

> **Bottom line.** `$expand=ListItemAllFields/Editor` — the obvious way to reach the editor through a file's list item — returns HTTP 400 on a folder's `Files` collection. Take the last editor and the author from the file itself — `ModifiedBy` and `Author`, one level deep.
>
> **Ve zkratce.** `$expand=ListItemAllFields/Editor` – nejsnazší cesta k editorovi přes položku seznamu, která k souboru patří – vrátí na kolekci `Files` složky HTTP 400. Posledního editora a autora ber přímo ze souboru – `ModifiedBy` a `Author`, jedna úroveň.

## Symptom

Listing a folder together with the name of whoever changed each file last:

```http
GET /_api/web/GetFolderByServerRelativeUrl('/sites/projects/Shared Documents/Contracts')/Files
    ?$select=Name,TimeLastModified,ListItemAllFields/Editor/Title
    &$expand=ListItemAllFields/Editor
```

answers

```
HTTP 400 – The $expand query is not valid for field 'Editor'
```

## Cause

On `/items`, the editor is one level away (`$expand=Editor`). Reached from a file through `ListItemAllFields`, it becomes a second level — and the `Files` collection rejects that.

## Fix

The file carries its own user properties, one level deep:

```http
GET …/Files?$select=Name,ServerRelativeUrl,TimeLastModified,ModifiedBy/Title&$expand=ModifiedBy
```

`Author` works the same way for the creator.

## Notes

- To list **one level** of a library, use the folder API — `…/Folders` and `…/Files` of that folder — rather than `items?$filter=FileDirRef eq '…'`. The filter runs over the whole list, so above the 5,000-item view threshold it gets throttled; the folder API asks about that one folder. Skip the system folders (`Forms`, names starting with `_`).
- Moving what you listed? `moveto` answers with an empty body: [Action endpoints return an empty body](action-endpoints-return-an-empty-body.md).
