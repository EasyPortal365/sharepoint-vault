---
title: "Writing metadata to an approved document without a new version: `ValidateUpdateListItem` breaks approval or fails with „Additions … blocked“ — CSOM `SystemUpdate` works"
short-title: "Metadata on an approved document without a new version: use CSOM `SystemUpdate`"
summary: On a no-script site bNewDocumentUpdate:true and UpdateOverwriteVersion fail, bNewDocumentUpdate:false creates a minor draft; CSOM ListItem.SystemUpdate writes text, number, choice and date without touching version, approval or Modified
tags: [rest-api, csom, versioning, content-approval, noscript]
applies-to: SharePoint Online (REST + CSOM ProcessQuery)
last-reviewed: 2026-11-27
---

# Writing metadata to an approved document without a new version: `ValidateUpdateListItem` breaks approval or fails with „Additions … blocked“ — CSOM `SystemUpdate` works

> **Bottom line.** To stamp a column (revision, valid-from date, status) on a document that is already **approved** in a library with content approval and minor versions, the usual REST routes fail: `ValidateUpdateListItem` with `bNewDocumentUpdate: false` turns the approved 2.0 into a **minor draft 2.1 pending approval**; `bNewDocumentUpdate: true` and CSOM `UpdateOverwriteVersion()` return **„Additions to this Web site have been blocked“** on a site without custom scripts — even for a site collection admin. CSOM **`ListItem.SystemUpdate()`** through `/_vti_bin/client.svc/ProcessQuery` writes text, number, choice and date in one request and leaves the version, the approval status and *Modified* untouched.
>
> **Ve zkratce.** Zápis sloupce (revize, platnost, stav) na už **schválený** dokument v knihovně se schvalováním obsahu a vedlejšími verzemi běžnými REST cestami nejde: `ValidateUpdateListItem` s `bNewDocumentUpdate: false` udělá ze schválené 2.0 **koncept 2.1 čekající na schválení**; `bNewDocumentUpdate: true` i CSOM `UpdateOverwriteVersion()` na webu bez vlastních skriptů vrátí **„Additions to this Web site have been blocked“** – i správci kolekce. CSOM **`ListItem.SystemUpdate()`** přes `/_vti_bin/client.svc/ProcessQuery` zapíše text, číslo, volbu i datum jedním požadavkem a verzi, stav schválení ani *Změněno* nemění.

## Measured (SharePoint Online, 2026-11-27, throwaway library, then deleted)

Library with content approval and minor versions, on a modern site where custom scripts are off (effective permission mask of the site collection admin `7fffffff / fffbffff` – `AddAndCustomizePages` missing). One PDF at **2.0, approved** (`_ModerationStatus` 0).

| Write | Result |
|---|---|
| `ValidateUpdateListItem`, `bNewDocumentUpdate: false` | value written, **new version 2.1, status 3 (draft)** – the approved state is gone for readers |
| `ValidateUpdateListItem`, `bNewDocumentUpdate: true` | **HTTP 500 „Additions to this Web site have been blocked.“** (with and without approval) |
| CSOM `UpdateOverwriteVersion()` | same „Additions … blocked“ error |
| CSOM `SystemUpdate()` | value written, version **2.0**, status **0**, *Modified* unchanged, no new history entry |

Also measured:

- Same `SystemUpdate` as a **non-admin owner** (no site collection admin, mask `fffbffff`) – works.
- On a file with a **draft on top** (2.1 over approved 2.0) `SystemUpdate` writes into the draft; 2.0 keeps the old value. Write **after** approval if readers must see it.
- **Dates:** a `DateTime` parameter **without a time zone** (`2026-11-28T00:00:00`) is taken in the site's time zone – the library shows 28 Nov (stored as `2026-11-27T23:00:00Z` on a UTC+1 site). An ISO value with `Z` is taken as UTC (`…T00:00:00Z` came back unchanged), so on a site west of UTC the shown day moves back by one. (`ValidateUpdateListItem` instead wants the site *locale* format, e.g. `11/28/2026` – any other format fails the whole request.)
- **Errors come in a 200.** A missing column returns HTTP 200 with `ErrorInfo.ErrorMessage` „Column 'X' does not exist“ – parse the body and treat the whole request as failed. An unknown file id answers the same way („File Not Found.“).
- Address the file by **`GetFileById(UniqueId)`** – no file name or path in the request, so nothing to encode.

## The request

```xml
POST {libraryWebUrl}/_vti_bin/client.svc/ProcessQuery
Content-Type: text/xml
X-RequestDigest: {digest of THAT web – /_api/contextinfo}

<Request xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009" SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="MyApp">
  <Actions>
    <Method Name="SetFieldValue" Id="10" ObjectPathId="5"><Parameters><Parameter Type="String">Revision</Parameter><Parameter Type="String">Rev 05</Parameter></Parameters></Method>
    <Method Name="SetFieldValue" Id="11" ObjectPathId="5"><Parameters><Parameter Type="String">ValidFrom</Parameter><Parameter Type="DateTime">2026-11-28T00:00:00</Parameter></Parameters></Method>
    <Method Name="SetFieldValue" Id="12" ObjectPathId="5"><Parameters><Parameter Type="String">RevNo</Parameter><Parameter Type="Double">5</Parameter></Parameters></Method>
    <Method Name="SystemUpdate" Id="13" ObjectPathId="5"/>
  </Actions>
  <ObjectPaths>
    <StaticProperty Id="1" TypeId="{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}" Name="Current"/>
    <Property Id="2" ParentId="1" Name="Web"/>
    <Method Id="4" ParentId="2" Name="GetFileById"><Parameters><Parameter Type="Guid">{file-unique-id}</Parameter></Parameters></Method>
    <Property Id="5" ParentId="4" Name="ListItemAllFields"/>
  </ObjectPaths>
</Request>
```

XML-escape the values (`&`, `<`, `>`, `"`). A Choice column takes the choice text as `String` (measured), a Number column a `Double`. Check the value against the column's `Choices` yourself before writing – a value outside the choices was not tested.

## Rule

- Metadata that must not disturb approval → `SystemUpdate`, written after approval.
- Never treat the HTTP status of either `ValidateUpdateListItem` or `ProcessQuery` as success – read the body.
- Assumption, not measured: the „Additions … blocked“ errors come from the missing `AddAndCustomizePages` right on no-script sites; a site with custom scripts allowed was not measured.
