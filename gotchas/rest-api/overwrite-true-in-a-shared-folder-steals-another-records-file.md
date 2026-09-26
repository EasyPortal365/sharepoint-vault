---
title: "`Overwrite=true` into a folder shared by many records silently replaces — and takes over — another record's file"
short-title: "`Overwrite=true` in a shared folder steals another record's file"
summary: "Uploading with `Files/AddUsingPath(…,Overwrite=true)` under a user-supplied file name into a folder that holds documents of many records (cases, orders, tickets) lets a second file with the same generic name (such as `image.jpg`) replace the first record's file — SharePoint keeps the same list item and adds a new version — and the metadata update that follows then re-links that item to the second record. Put the record key into the file name (or give every record its own folder), and add it when moving older files"
tags: [rest-api, documents, upload, libraries, data-loss]
applies-to: SharePoint Online document libraries used by custom solutions that store files of many records in one folder and upload with `Files/AddUsingPath(DecodedUrl=…,Overwrite=true)` or move with `MoveToUsingPath(…,moveOperations=1)`
last-reviewed: 2026-09-26
---

# `Overwrite=true` into a folder shared by many records silently replaces — and takes over — another record's file

> **Bottom line.** `Overwrite=true` is only safe when the file name belongs to exactly one record. In a folder shared by many records, a user-supplied name — or a generic one such as `image.jpg`, which iOS Safari has been reported to give photos uploaded through a file input — eventually collides: the second upload replaces the first record's file (same list item, new version), and your metadata update then re-links that item to the second record. Put the record key into the file name (or use one folder per record) and add the key when moving older files.
>
> **Ve zkratce.** `Overwrite=true` je bezpečné jen tam, kde jméno souboru patří právě jednomu záznamu. Ve složce společné víc záznamům jméno od uživatele – nebo obecné jméno jako `image.jpg`, které podle hlášení dává Safari na iOS fotkám nahraným přes formulář – dřív nebo později koliduje: druhé nahrání nahradí soubor prvního záznamu (tatáž položka, nová verze) a zápis metadat pak položku přepojí k druhému záznamu. Dej klíč záznamu do názvu souboru (nebo každému záznamu vlastní složku) a při přesunu starších souborů ho doplň.

## Symptom

A document disappears from one record and shows up under another one. Nobody deleted anything, there is no error, and the version history of the file shows a new version uploaded by someone working on a different record.

Typical setup: a case-management solution keeps all case documents in a few folders split by who may see them (everyone / HR / safety officer), uploads with the name the user typed or the name of the picked file, and after the upload writes the case id into a lookup or number column of the file's list item.

We found this in a code review before it hit users; the SharePoint behaviour below was then measured on a test library with versioning switched on.

## Cause

```text
POST …/GetFolderByServerRelativePath(decodedurl='/sites/x/CaseDocs/Everyone')
     /Files/AddUsingPath(DecodedUrl='image.jpg',Overwrite=true)?$expand=ListItemAllFields
```

1. Case A uploads `image.jpg` → new file, list item 41 (version 1.0), metadata `CaseId = A`.
2. Case B uploads its own `image.jpg` into the same folder → SharePoint replaces the content of the **same** file: `ListItemAllFields.Id` is still 41 and the file is now version 2.0 (measured; without versioning the content is simply replaced).
3. The solution writes `CaseId = B` into item 41. Case A has lost its document; case B shows A's history.

A move with `MoveToUsingPath(DecodedUrl=…,moveOperations=1)` (overwrite) into a folder that already holds a file of the same name replaces that file — the other record loses its document even though no metadata is re-linked.

## Fix

- Make the name unique per record: prefix it with the record key, for example `CASE-2026-007 – image.jpg`, sanitised the same way as the rest of the name. Do not prefix twice when the name already starts with the key.
- When a file is moved to another folder, add the key to its name at the same time — older files uploaded before the fix may still carry bare names.
- Keep the file extension when you shorten long names.
- An identical name within the **same** record is fine — that is a new version of the same document, which is usually what the user wants.
- Alternatively give every record its own folder, if your permission model allows it (breaking inheritance per record folder has its own costs).

A cheap regression test: upload `image.jpg` for two different records against a fake HTTP client and assert that the two `AddUsingPath` URLs differ.
