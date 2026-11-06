---
title: "`StorageMetrics` lies two ways — all zeros, or plausible numbers from an older state"
short-title: StorageMetrics can be stale, not just zero
summary: "zero = not calculated, but non-zero can be stale (261 files / 3.1 GB vs real 794 / 9.5 GB); trust it only when `TotalFileCount` exactly matches the files you counted"
tags: [rest-api, storage, document-library, versions, migration]
applies-to: SharePoint Online REST (`GetFolderByServerRelativePath(...)/StorageMetrics`)
last-reviewed: 2026-11-06
---

# `StorageMetrics` lies two ways

> **Bottom line.** `GET …/GetFolderByServerRelativePath(decodedurl=@p)/StorageMetrics` answers `200` either way. Sometimes it returns **all zeros** for a library that has files (metrics not calculated yet). Sometimes it returns **plausible non-zero numbers that describe an older state** of the library — measured on a production tenant: `TotalFileCount` 261 and `TotalSize` 3.10 GB, while the library held 794 files and the per-file `File.Length` sum was 9.47 GB. A "zero means not calculated" guard catches only the first case. Trust the metrics only when `TotalFileCount` **exactly** matches the number of files you counted yourself; otherwise sum `File.Length` and report version-history size as unknown.
>
> **Ve zkratce.** `…/StorageMetrics` odpoví `200` v obou případech. Někdy vrátí **samé nuly** pro knihovnu, která soubory má (metriky ještě nejsou spočítané). Jindy vrátí **věrohodně vypadající čísla ze staršího stavu** knihovny – naměřeno v ostrém tenantu: `TotalFileCount` 261 a `TotalSize` 3,10 GB, přitom knihovna měla 794 souborů a součet `File.Length` byl 9,47 GB. Pojistka „nula = nespočítáno“ chytí jen první případ. Metrikám věřte, jen když `TotalFileCount` **přesně** sedí na počet souborů, který jste sami napočítali; jinak sečtěte `File.Length` a objem historie verzí uveďte jako neznámý.

## Symptom

Two screens of the same tool show two sizes for the same library: a pre-migration scan says "3.1 GB, 208 MB of version history", the post-copy verification says "9.5 GB". The verification (per-file sum) is right; the scan read `StorageMetrics`.

## Why

The metrics are not computed when you read them — they are refreshed in the background (observed, not documented). A fresh library has none yet (zeros, `LastModified` `0001-01-01`); a library that changed a lot since the last calculation keeps the old figures. We know of no field in the response that reliably tells a stale answer from a current one — hence the count check below.

## Fix

```js
const m = await get(`${web}/_api/web/GetFolderByServerRelativePath(decodedurl=@p)/StorageMetrics` +
  `?@p='${libRoot}'&$select=TotalSize,TotalFileStreamSize,TotalFileCount`);
// …page through the library items you read anyway, count FSObjType === 0 → countedFiles
const current = m.TotalFileCount > 0 && Number(m.TotalFileCount) === countedFiles;
const historyBytes = current ? m.TotalSize - m.TotalFileStreamSize : null; // null = unknown, not 0
const libraryBytes = sumOfFileLength;                                     // always per file
```

- **No percentage tolerance.** 261 vs 794 is not rounding; a threshold only moves the line below which the numbers lie again.
- If you can't count all files (read cap hit), you can't validate the metrics — don't use them.
- Files under the library's `Forms` folder (view pages, content-type templates) are not list items — a default library has 8 of them (`AllItems.aspx`, `DispForm.aspx`, `EditForm.aspx`, `Upload.aspx`, `Combine.aspx`, `repair.aspx`, `Thumbnails.aspx`, `template.dotx`). Whether `TotalFileCount` includes them we could not confirm (every library on our test tenant returned zeros), so if you allow for them, count them (`…/GetFolderByServerRelativePath(decodedurl='<root>/Forms')?$select=Name&$expand=Files,Folders/Files`) rather than guessing a constant.
- Show current-version size from the per-file sum everywhere, so a scan and a later verification can't disagree.

## Related

- [Copy and Move keeps versions, timestamps and authors](copy-and-move-keeps-versions-timestamps-and-authors.md) — where the all-zeros case first showed up.
- [A version is a full copy, not a delta](../lists/a-version-is-a-full-copy-not-a-delta.md) — why `TotalSize − TotalFileStreamSize` (the history) can be large.
