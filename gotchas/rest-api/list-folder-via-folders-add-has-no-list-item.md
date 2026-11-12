---
title: "A folder created with folders/AddUsingPath in a generic list has no list item — breaking its permissions returns 404"
short-title: "`folders/AddUsingPath` in a generic list makes a folder without a list item"
summary: "In a custom list (BaseTemplate 100) `web/folders/AddUsingPath` creates a 'naked' folder: `ListItemAllFields` is `odata.null` and `breakroleinheritance` is 404. Create list folders with `AddValidateUpdateItemUsingPath` and `UnderlyingObjectType: 1`, then check the item state, not just `Exists`"
tags: [rest-api, lists, folders, permissions]
applies-to: SharePoint Online (measured 2026-11-12)
last-reviewed: 2026-11-12
---

# A folder created with `folders/AddUsingPath` in a generic list has no list item — breaking its permissions returns 404

> **Bottom line.** In a document library, `web/folders/AddUsingPath` gives you a folder *and* its list item. In a generic list (BaseTemplate 100) it gives you only the folder: no list item, so there is nothing to break permissions on. Create folders in lists with `GetList(…)/AddValidateUpdateItemUsingPath` and `UnderlyingObjectType: 1`, and after creating, check that the folder has a list item — `Exists: true` proves nothing.
>
> **Ve zkratce.** V knihovně dokumentů dá `web/folders/AddUsingPath` složku i s položkou seznamu. V obyčejném seznamu (BaseTemplate 100) jen složku bez položky – a na ní se oprávnění nastavit nedají. Složky v seznamu zakládej přes `GetList(…)/AddValidateUpdateItemUsingPath` s `UnderlyingObjectType: 1` a po založení ověř, že složka má položku – `Exists: true` nic nedokazuje.

## Symptom

You keep per-record data in a custom list and give every record its own folder with unique permissions (a common way to keep rows of one person readable only by HR and that person). The same helper has worked for years in document libraries. In the list:

```http
POST /_api/web/folders/AddUsingPath(DecodedUrl='/sites/hr/Lists/Pay/12')   → 200
GET  /_api/web/GetFolderByServerRelativePath(DecodedUrl='/sites/hr/Lists/Pay/12')?$select=Exists   → { "Exists": true }
POST /_api/web/GetFolderByServerRelativePath(DecodedUrl='/sites/hr/Lists/Pay/12')/ListItemAllFields/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)   → 404
```

The folder exists, yet every permission call on it fails.

## Cause

In a generic list, `web/folders/AddUsingPath` creates the folder in the list's file system but **does not create the list item** that represents it:

```http
GET …/GetFolderByServerRelativePath(DecodedUrl='/sites/hr/Lists/Pay/12')/ListItemAllFields?$select=Id
→ { "odata.null": true }
```

The folder shows up in `/folders` but not in `/items`. Permissions live on the list item (`ListItemAllFields/roleassignments`), so with no item there is nothing to break inheritance on — hence 404. In a document library the same method creates the item, which is why the trap stays hidden until a library pattern is reused in a list.

## Fix

Create list folders as list items:

```http
POST /_api/web/GetList(@l)/AddValidateUpdateItemUsingPath?@l='%2Fsites%2Fhr%2FLists%2FPay'
Content-Type: application/json;odata=nometadata

{
  "listItemCreateInfo": {
    "FolderPath": { "DecodedUrl": "/sites/hr/Lists/Pay" },
    "LeafName":   { "DecodedUrl": "12" },
    "UnderlyingObjectType": 1
  },
  "formValues": [ { "FieldName": "Title", "FieldValue": "12" } ],
  "bNewDocumentUpdate": false
}
```

This works even when the list has `EnableFolderCreation: false` — that setting only hides the *New folder* button in the UI.

Then make your helper check the item state, not existence:

1. After creating (or finding) the folder, read `…/ListItemAllFields?$select=Id`. `odata.null` = naked folder, an `Id` = a real item. Only then break inheritance.
2. If a naked folder already exists and is **empty** (`?$select=ItemCount` → 0), send it to the recycle bin (`…/recycle()`) and create it again as an item. If it is not empty, stop and report it — deleting a folder whose contents have no item would lose them.
3. Rows you add into the folder later (`AddValidateUpdateItemUsingPath` with `UnderlyingObjectType: 0` and `FolderPath` set to the folder) inherit its permissions as usual.
