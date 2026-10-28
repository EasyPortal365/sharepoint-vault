---
title: FirstUniqueAncestorSecurableObject has no type in odata=nometadata — tell web, list and item apart by the shape of the answer
short-title: FirstUniqueAncestorSecurableObject has no type in nometadata
summary: The endpoint returns a web, a list or a list item depending on where inheritance breaks, and with `odata=nometadata` nothing names the type; classify by properties (`FileSystemObjectType` = item, `BaseTemplate` = list, otherwise web) and treat an unknown shape as restricted
tags: [permissions, rest-api, inheritance, odata, secondary-store]
applies-to: SharePoint Online REST — `…/ListItemAllFields/FirstUniqueAncestorSecurableObject`, typically when data about a file is stored somewhere else and must not be readable by more people than the file
last-reviewed: 2026-10-28
---

# FirstUniqueAncestorSecurableObject has no type in odata=nometadata — tell web, list and item apart by the shape of the answer

> **Bottom line.** `GET …/GetFileByServerRelativePath(decodedurl='…')/ListItemAllFields/FirstUniqueAncestorSecurableObject` returns the object whose permissions the file actually uses: the **web**, the **library** or a **folder/file item**. With `Accept: application/json;odata=nometadata` the response carries no type name, so read the shape: `FileSystemObjectType` present = list item (the file or a folder has unique permissions), `BaseTemplate` present = list (the library has unique permissions), `ServerRelativeUrl`/`WebTemplate` without those = web. Anything else — or a failed read — treat as restricted, not as "same as the web". `…/FirstUniqueAncestorSecurableObject/RoleAssignments` then gives the assignments to copy.
>
> **Ve zkratce.** Endpoint vrací objekt, jehož oprávnění soubor skutečně používá – web, knihovnu nebo položku (soubor či složku). S `odata=nometadata` v odpovědi typ není, takže rozhoduje tvar: `FileSystemObjectType` = položka, `BaseTemplate` = seznam, jinak web. Neznámý tvar nebo selhané čtení ber jako omezený přístup, ne jako „stejně jako web“. Přiřazení ke zkopírování vrátí `…/FirstUniqueAncestorSecurableObject/RoleAssignments`.

## Why you need it

A common pattern stores extra data about a document outside the document — a hidden list with notes, labels or named versions keyed by the file's `UniqueId` (writing to the file's own fields would create a new version). That list inherits the **web's** permissions. For most files that is fine; for a file in a restricted library or folder it leaks: everyone with read access to the web can read the stored data, including people who cannot open the file.

The fix is to give such a record a copy of the file's effective permissions — which means first finding out *whose* permissions the file uses.

## Recipe

1. `GET …/ListItemAllFields/FirstUniqueAncestorSecurableObject` (nometadata) and classify:

   ```js
   function scopeOwner(o) {
     if (!o || typeof o !== 'object') return 'unknown';
     if ('FileSystemObjectType' in o) return 'item';   // file or folder has unique permissions
     if ('BaseTemplate' in o) return 'list';           // the library has unique permissions
     if ('WebTemplate' in o || 'ServerRelativeUrl' in o) return 'web';
     return 'unknown';                                 // treat as restricted
   }
   ```

2. `web` → the record can inherit (the hidden list inherits the same web). Anything else → copy:
   `GET …/FirstUniqueAncestorSecurableObject/RoleAssignments?$expand=RoleDefinitionBindings&$select=PrincipalId,RoleDefinitionBindings/Id,RoleDefinitionBindings/RoleTypeKind,RoleDefinitionBindings/Hidden`
   and skip bindings with `RoleTypeKind = 1` (Limited Access) and `Hidden = true`.
3. On the new record: `breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)`, then `addroleassignment(principalid=…,roledefid=…)` for each pair. SharePoint adds the **current user** when breaking without copying (see [break-without-copy-keeps-only-you](break-without-copy-keeps-only-you.md)) — read `roleassignments` back and remove principals that are not in the source set.
4. Breaking inheritance needs **Manage Permissions** on the record. Check it (`EffectiveBasePermissions`, bit `0x02000000` in `Low`) *before* writing the record and refuse with an explanation; if copying fails after the record exists, delete the record so it does not stay readable to the whole web.

## Measured

28 Oct 2026, SharePoint Online: a library with unique permissions returned an object with `BaseTemplate: 101`; a file with its own permissions returned `FileSystemObjectType: 0`; the copied assignments on the hidden-list item matched the library's exactly (Limited Access excluded), and the file's `UIVersionLabel` stayed unchanged.

## Caveat

The copy is a snapshot. If the file's permissions change later, the record keeps the old ones — re-copy when the record is next edited, or accept the window.
