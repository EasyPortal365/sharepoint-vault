---
title: Get lists by URL, not by title
tags: [rest-api, lists, csom, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-15
---

# Get lists by URL, not by title

> **Bottom line.** `getbytitle()` breaks the moment anyone renames the list (or switches UI language) — resolve lists by their fixed server-relative URL via `GetList(@u)` instead.
>
> **Ve zkratce.** `getbytitle()` přestane fungovat, jakmile někdo seznam přejmenuje (nebo přepne jazyk UI) – řeš seznamy přes jejich neměnnou server-relativní URL pomocí `GetList(@u)`.

## Symptom

REST calls that worked for months suddenly return **404 Not Found**:

```http
GET /_api/web/lists/getbytitle('Project Documents')/items
```

Nothing changed in your code. The list is right there in the browser.

## Cause

Someone renamed the list. `getbytitle()` resolves the **display title**, which any list owner can change in list settings at any time. The list's **URL segment** (`/Lists/ProjectDocuments`, `/Shared Documents`) is fixed at creation and survives renames.

Bonus trap: on multilingual sites (MUI), the display title can differ per UI language — so `getbytitle` may break only for *some* users.

## Fix

Resolve lists by server-relative URL:

```http
GET /_api/web/GetList(@u)?@u='/sites/projects/Lists/ProjectDocuments'
```

TypeScript / SPFx:

```ts
const listUrl = `${this.context.pageContext.web.serverRelativeUrl}/Lists/ProjectDocuments`;
const endpoint = `${webAbsoluteUrl}/_api/web/GetList(@u)?@u='${listUrl}'&$select=Id,Title`;
```

PnP.PowerShell accepts the URL form directly:

```powershell
Get-PnPList -Identity 'Lists/ProjectDocuments'
```

CSOM: `web.GetList(serverRelativeUrl)`.

## Notes

- Document libraries live at the web root (`/Shared Documents`), not under `/Lists/`.
- If a title must be user-facing configuration, resolve it once, store the list **ID (GUID)**, and re-resolve on 404.
- The same rename risk applies to anything keyed by display names: views, fields (use internal names), content types.
