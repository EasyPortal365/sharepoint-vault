---
title: RecycleByID sends a file version to the recycle bin — DeleteByID does not
tags: [rest-api, files, versioning, recycle-bin, cleanup]
applies-to: SharePoint Online
last-reviewed: 2026-09-23
---

# `RecycleByID` sends a file version to the recycle bin — `DeleteByID` does not

> **Bottom line.** The version collection has two removal methods and they are not the same. `Versions/DeleteByID(vid=…)` (what most scripts and PnP's `Remove-PnPFileVersion` without `-Recycle` use) removes the version **permanently**. `Versions/RecycleByID(vid=…)` returns `200 {"odata.null":true}`, the version disappears from the history, and it shows up in the **site recycle bin as `ItemType 2` (FileVersion)** — restorable for the usual retention window. If your tool trims history, use the recycle variant unless you have a reason not to.
>
> **Ve zkratce.** Kolekce verzí má dvě mazací metody a nejsou stejné. `DeleteByID` maže **natrvalo**; `RecycleByID` verzi přesune do **koše webu** (položka typu 2 = FileVersion), odkud jde obnovit. Nástroj, který ořezává historii, má sahat po koši.

## The two calls

```http
POST /_api/web/GetFileByServerRelativePath(decodedurl=@p)/Versions/DeleteByID(vid=512)?@p='/sites/team/Docs/Contract.docx'
POST /_api/web/GetFileByServerRelativePath(decodedurl=@p)/Versions/RecycleByID(vid=512)?@p='/sites/team/Docs/Contract.docx'
```

`vid` is the version's `ID` from the `/Versions` collection — `major * 512 + minor`, so `1.0` is `512`, `2.3` is `1027`. Both calls need a request digest like any other write.

## Measured (2026-09-17, SharePoint Online)

A test library with versioning on, a file with versions `1.0`–`6.0`:

1. `RecycleByID(vid=512)` → `200`, body `{"odata.null":true}`.
2. `/Versions` now starts at `2.0` — `1.0` is gone from the history.
3. `/_api/site/RecycleBin?$orderby=DeletedDate desc&$top=1` → the file's `LeafName`, `ItemType: 2`, `ItemState: 1` (first-stage bin), `Size` of that one version.

The same probe with `DeleteByID` leaves nothing in either recycle bin — which is why the trimming script in this repo recycles by default and deletes for good only when you pass `-Permanent`.

## Why it matters

Version trimming is exactly the kind of bulk operation where a wrong rule (off-by-one in "keep the newest N", wrong age threshold, a document that changed state while the job ran) is discovered *after* the run. With `RecycleByID` the fix is "restore from the recycle bin"; with `DeleteByID` it is "explain to the owner".

Two things `RecycleByID` does **not** buy you:

- The **current** version is never in `/Versions` and cannot be recycled this way — nor should it be.
- Recycled versions still count against the site's storage until the bin empties, so "space freed" is only real after the retention window.

## Related

- [File versions come back oldest-first](file-versions-are-oldest-first.md) — read the whole history before deciding what to trim; a `$top` cuts the newest end.
- [`Remove-ExcessFileVersions.ps1`](../../scripts/cleanup/Remove-ExcessFileVersions.ps1) — the PowerShell trimmer; recycles by default (CSOM `RecycleByID`), `-Permanent` deletes for good. With plain PnP cmdlets the equivalent is `Remove-PnPFileVersion -Identity <version> -Recycle` (the `-All` switch cannot recycle).
