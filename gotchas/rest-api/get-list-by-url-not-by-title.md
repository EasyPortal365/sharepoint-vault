---
title: Get lists by URL, not by title
tags: [rest-api, lists, csom, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-24
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

## Bonus: `GetList` accepts paths *inside* the list too (verified live 2026-08)

The docs say `GetList` takes the server-relative URL *of the list*, but SharePoint Online quietly **normalises any existing path inside the list to the list itself**:

```http
GET /_api/web/GetList(@u)?@u='/sites/x/Shared Documents/Contracts/2026'
```

returns **200** with the library's `Title` — and `RootFolder/ServerRelativeUrl` gives you the library root. A **404 means the path does not exist at all**, not "this is a folder, give me the root".

Two practical consequences:

- Resolving "which library does this folder path belong to?" is a **single request**: `GetList('<any path>')?$select=RootFolder/ServerRelativeUrl&$expand=RootFolder`. No segment-walking needed (keep the walk only as a fallback).
- Don't diagnose "GetList must 404 on folder paths" from reading code or docs — this behaviour difference is exactly the kind of thing to **verify with a live A/B request** before calling it a bug.

Caveat: when you probe *permissions* for a target folder, prefer the folder's own item (`getfolderbyserverrelativeurl('<path>')/ListItemAllFields/EffectiveBasePermissions`) over the list-level answer — a folder with unique permissions would otherwise get the library's verdict, not its own.
