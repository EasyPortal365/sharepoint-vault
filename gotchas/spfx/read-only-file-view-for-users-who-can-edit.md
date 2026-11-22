---
title: Show a file read-only to a user who is allowed to edit it
short-title: Read-only file view for editors
summary: "Office for the web in embedview or interactivepreview hides the editing toolbar, but its full-screen button opens “Edit document”, and the `/preview` API returns 403 to a user with Contribute – a PDF viewer in an iframe (`content?format=pdf` for Office files) is the reliable read-only view"
tags: [spfx, rest-api, office-online, permissions, ux]
applies-to: SharePoint Online, SharePoint Framework, Office for the web
last-reviewed: 2026-11-22
---

# Read-only file view for a user who can edit

> **Bottom line.** You cannot make Office for the web read-only for someone who has edit rights. `Doc.aspx?…&action=embedview` and `action=interactivepreview` hide the toolbar, but the full-screen button in the corner opens the document with **Edit document**. The `/preview` API (read-only embed token) refuses a Contribute user with 403. For a dependable read-only view, show the file in the browser's PDF viewer: PDF by its direct URL, Word/Excel/PowerPoint through `content?format=pdf`.
>
> **Ve zkratce.** Office pro web nejde udělat jen pro čtení pro toho, kdo smí soubor měnit. Režim `embedview` i `interactivepreview` skryje lištu, ale ikona celé obrazovky otevře dokument s **Upravit dokument**. API `/preview` (token jen pro čtení) vrátí uživateli s Přispívat 403. Spolehlivý náhled jen pro čtení je prohlížeč PDF v iframu: PDF přímou adresou, Word, Excel a PowerPoint přes `content?format=pdf`.

## Symptom

You want users who have **Contribute** on a library (they must, to publish) to *open* final documents without an editing mode, so a stray click does not start autosaved edits.

- `/_layouts/15/Doc.aspx?sourcedoc={id}&action=embedview` and `action=interactivepreview`: no ribbon, no *Edit* button. The status bar's menu offers *Download a copy*, *Print to PDF*, accessibility and embed information – no editing.
- But the **full-screen icon** (bottom right) opens a new tab with `action=view&wdEmbedFS=1` – the normal viewer with **Edit document**.
- `POST /_api/v2.0/drives/{drive}/items/{item}/preview` returns a `getUrl` with a read-only token for a site owner, but **403 `accessDenied`** for a Contribute user (measured 2026-11-22).

## Why

The viewer modes only hide controls; the user's permission to edit is unchanged, and both modes leave a path back to the full viewer. The preview endpoint refused Contribute (an owner passed).

## Fix

```ts
// Same origin, the user's own session. driveId/itemId from /_api/v2.0/drives and root:/{path}:
const viewUrl = isPdf
  ? origin + encodeURI(serverRelativePath)                       // browser PDF viewer
  : `${webUrl}/_api/v2.0/drives/${driveId}/items/${itemId}/content?format=pdf`; // converted
iframe.src = viewUrl;

// Original file, started synchronously in the click (popup/download rules):
const downloadUrl = `${webUrl}/_layouts/15/download.aspx?SourceUrl=${encodeURIComponent(origin + serverRelativePath)}`;
```

- `content?format=pdf` redirects to the conversion service; as an iframe `src` on a SharePoint page it renders in the browser's PDF viewer (measured as a Contribute user).
- Apply it everywhere the file is shown, including an embedded *Preview* tab – an embedded Office viewer has the same full-screen button.
- Decide by the user's effective permission on the library (`EffectiveBasePermissions`, `EditListItems` = bit `0x4` of `Low`), not by an app role, and keep the normal SharePoint viewer for read-only users.
- Test with the lowest role that has the right, never only as an admin.
