---
title: Renaming a file via FileLeafRef — a dot in the new name is read as the extension
short-title: "Rename with FileLeafRef – send the extension"
summary: "`FileLeafRef` without the extension cuts the name at the first dot (`F1.02 Plan` → `F1.docx`); always send the full name with its extension"
tags: [rest-api, files, libraries]
applies-to: SharePoint Online
last-reviewed: 2026-11-23
---

# Renaming a file via `FileLeafRef`: a dot in the new name is read as the extension

> **Bottom line.** When you rename a document with `ValidateUpdateListItem` and `FileLeafRef`, send the **full name including the extension**. Without it SharePoint treats everything after the first dot as the extension and replaces it, so `F1.02 Plan` becomes `F1.docx`.
>
> **Ve zkratce.** Při přejmenování dokumentu přes `ValidateUpdateListItem` a `FileLeafRef` posílej **celý název i s příponou**. Bez ní SharePoint vezme vše za první tečkou jako příponu a nahradí ji – z `F1.02 Plan` vznikne `F1.docx`.

## Symptom

You rename a file in place (keeping the item, its ID and version history) and pass the new base name, the way the library form shows the *Name* field — without the extension:

```http
POST …/_api/web/GetList('/sites/x/Docs')/items(2)/ValidateUpdateListItem
{ "formValues": [{ "FieldName": "FileLeafRef", "FieldValue": "F1.02 Sample procedure" }],
  "bNewDocumentUpdate": true }
```

The call returns **200** with no field exception — and the file is now called **`F1.docx`**.

## Cause

SharePoint splits the value at the **first** dot: `F1` is taken as the base name and `.02 Sample procedure` as an "extension", which it then swaps for the file's real extension. Names without a dot (`Sample procedure`) work, which is why it slips through testing. Numbered document names (`F1.02 …`, `4.3 …`, `v1.2 …`) hit it every time.

## Fix

Send the complete file name, extension included — SharePoint keeps it as given:

```http
{ "formValues": [{ "FieldName": "FileLeafRef", "FieldValue": "F1.02 Sample procedure.docx" }],
  "bNewDocumentUpdate": true }
```

Always read `FileLeafRef` back after the call and compare it with what you sent; the 200 response alone proves nothing. `bNewDocumentUpdate: true` renames without creating a new version (the `Modified` stamp still changes).
