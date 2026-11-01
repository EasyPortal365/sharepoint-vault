---
title: "Copy jobs fed with file URIs: the folders you pre-create carry your account and today's date – and the TaxCatchAll warning is just image tags"
short-title: "Copy job by files: folder metadata is lost"
summary: "A CreateCopyJobs job that gets folder URIs carries folder metadata, a job fed with file URIs needs existing target folders, and folders created with AddUsingPath show the running account and the creation time until you rewrite Created/Modified/Author/Editor with ValidateUpdateListItem; the JobWarning 'Field TaxCatchAll cannot be found' comes from the automatic Image Tags column"
tags: [rest-api, copy-move, migration, folders, managed-metadata]
applies-to: SharePoint Online
last-reviewed: 2026-11-01
---

# Copy jobs fed with file URIs: the folders you pre-create carry your account and today's date – and the TaxCatchAll warning is just image tags

> **Bottom line.** If you pass `CreateCopyJobs` a folder URI, the folder is copied as an item (in our runs it kept its Created/Modified/Author/Editor). If you pass file URIs (to skip some files, retry failures or fill gaps), the destination folders must already exist, and folders you create with `Folders/AddUsingPath` show the running account and the creation time. Rewrite them after the copy with `ValidateUpdateListItem` on the folder's list item – all four fields in one call, `bNewDocumentUpdate: true`, dates in the site's regional format – and only on folders your own account created. A `JobWarning` "Field TaxCatchAll cannot be found. Field value will not be imported" usually comes from the automatic **Image Tags** column (`MediaServiceImageTags`) in the source library, not from your data.
>
> **Ve zkratce.** Úloha s adresou složky přenese i metadata složky. Úloha se soubory potřebuje existující cílové složky, a ty, které založíš přes `AddUsingPath`, ukazují tvůj účet a čas založení. Po kopii jim přepiš čtveřici Vytvořil, Změnil, Vytvořeno, Změněno přes `ValidateUpdateListItem` (všechna čtyři pole, `bNewDocumentUpdate: true`, datum v regionálním formátu webu) – jen u složek, které založil tvůj účet. Varování `TaxCatchAll` obvykle pochází z automatického sloupce Značky obrázků, ne z tvých dat.

## Symptom

A library migration copied ~800 files with their history, authors and dates intact. In the destination, every folder showed *Modified: 20 minutes ago* and *Modified By: \<the service account running the migration\>*. Earlier runs of the same tool had preserved folder metadata.

During the same run, one job log carried:

```
JobWarning: Field TaxCatchAll cannot be found. Field value will not be imported
```

## Cause

1. **Folder URI vs file URIs.** With a folder URI the job copies the folder item itself (earlier runs in this mode kept folder metadata). With file URIs it copies only the files into a destination folder that must already exist (a job takes URIs from one parent folder into one existing destination). The tool switched to file URIs whenever it had to leave some files out (skip-existing, newer-only, retries), and created the destination folders itself with `Folders/AddUsingPath`. Those folder items are ordinary new items: author = caller, Created = now.
2. **TaxCatchAll.** SharePoint adds the managed-metadata column *Image Tags* (`MediaServiceImageTags`, `TaxonomyFieldTypeMulti`) and the hidden lookup `TaxCatchAll` to document libraries on its own (media processing). In our tenant both fields were present in site asset and template libraries and absent from an empty Documents library; we did not pin down the exact trigger. A freshly created destination library has neither, so the job cannot carry the hidden field and warns. The files are fine; only the automatically generated image tags do not travel.

## Fix

After the copy, compare source and destination folders (read both libraries' `/items` with `$select=Id,FileRef,FSObjType,Created,Modified,AuthorId,Author/Name,Editor/Name&$expand=Author,Editor` and filter `FSObjType === 1` in code – a server-side `$filter` on `FSObjType` hits the list view threshold on big libraries). For each folder that differs and was created by your account:

```js
// time values: UTC → site local time via /_api/web/regionalsettings/timezone/utctolocaltime('…'),
// then formatted per /_api/web/RegionalSettings (DateFormat, DateSeparator, Time24)
await post(`${web}/_api/web/GetList('${libUrl}')/items(${folderId})/ValidateUpdateListItem`, {
  formValues: [
    { FieldName: 'Author',   FieldValue: JSON.stringify([{ Key: sourceAuthorLogin }]) },
    { FieldName: 'Editor',   FieldValue: JSON.stringify([{ Key: sourceEditorLogin }]) },
    { FieldName: 'Created',  FieldValue: '3/2/2015 9:00 AM' },   // site format
    { FieldName: 'Modified', FieldValue: '6/1/2019 12:00 PM' }
  ],
  bNewDocumentUpdate: true
});
```

Measured: the folder item accepted all four values exactly (Created 2015, Modified 2019, a different user as author and editor), confirmed by reading `AuthorId`, `EditorId`, `Created`, `Modified` back. Always read back – `ValidateUpdateListItem` returns HTTP 200 with per-field `HasException` and can drop `Author` silently when it is sent without the other fields.

## Notes

- Send all four fields every time; check `HasException` per field and read back.
- Do not rewrite folders someone else created in the destination – compare the folder's `AuthorId` with the running account first.
- A user-defined managed-metadata column in the source shows up in the column list as `TaxonomyFieldType`/`TaxonomyFieldTypeMulti`; that one does lose values when the destination has no matching column. The warning alone does not tell you which case you are in.
