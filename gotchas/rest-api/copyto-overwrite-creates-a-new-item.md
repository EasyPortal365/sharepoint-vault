---
title: CopyToUsingPath with bOverwrite=true replaces the target with a NEW item — links, versions and metadata of the target are lost
short-title: Copy with overwrite creates a new item
summary: CopyTo/CopyToUsingPath over an existing file deletes the target item and inserts a new one (new Id, new UniqueId); overwrite content with Files/AddUsingPath or the flow action Update file instead
tags: [rest-api, files, copy, power-automate, links]
applies-to: SharePoint Online
last-reviewed: 2026-11-26
---

# `CopyToUsingPath` with overwrite creates a new item

> **Bottom line.** Copying a file over an existing one with `CopyToUsingPath(DecodedUrl=…, bOverwrite=true)` returns 200 and the new content — but the target is now a **different list item** (new `Id`, new `UniqueId`, version history restarted at 1.0). Sharing links (`?d=w<UniqueId>`), lookups to the item Id and the target's own column values are gone. To replace the content of a file people link to, write the content into the existing item: `Files/AddUsingPath(…, Overwrite=true)` from code, or the SharePoint connector action **Update file** in Power Automate.
>
> **Ve zkratce.** Kopie přes existující soubor (`CopyToUsingPath` s `bOverwrite=true`) vrátí 200 a nový obsah, ale cíl je NOVÁ položka – jiné Id i UniqueId, historie verzí od 1.0. Odkazy, vyhledávací pole i vlastní hodnoty cíle zmizí. Obsah souboru, na který vedou odkazy, přepisujte do existující položky: `Files/AddUsingPath(…, Overwrite=true)` v kódu, v Power Automate akce **Aktualizovat soubor** (Update file).

## Measured

Same library, target uploaded first (item Id 17, version 1.0):

```http
POST /_api/web/GetFileByServerRelativePath(decodedurl='/sites/x/Docs/source.txt')
     /CopyToUsingPath(DecodedUrl='/sites/x/Docs/target.txt',bOverwrite=true)
→ 200
```

Afterwards `target.txt` has the source content, but `ListItemAllFields/Id` = 18, `UniqueId` differs, `UIVersionLabel` = 1.0.

For comparison, both of these keep the item (same `Id` and `UniqueId`):

- `Files/AddUsingPath(DecodedUrl='target.txt',Overwrite=true)` with the new bytes → new version 2.0 of the same item;
- `MoveToUsingPath(DecodedUrl='…/new-name.txt',moveOperations=0)` → same item under a new name.

## Rule

- Replacing the current version of a document that others link to → overwrite the bytes of the existing item, never copy over it.
- `CopyToUsingPath` without overwrite is fine for **new** files (archive copies, templates).
- In Power Automate: *Get file content* (source) + *Update file* (target item id). Do not use *Copy file* with "Replace" for this.
