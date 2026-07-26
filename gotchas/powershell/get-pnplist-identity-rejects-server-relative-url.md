---
title: "`Get-PnPList -Identity` rejects server-relative URLs"
tags: [powershell, pnp-powershell, lists]
applies-to: PnP.PowerShell 2.x/3.x
last-reviewed: 2026-07-26
---

# `Get-PnPList -Identity` rejects server-relative URLs

> **Bottom line.** `-Identity` resolves a list by title, GUID, or **web-relative** URL — a server-relative path like `/sites/team/shared` never matches and fails with "List does not exist" even though it plainly does; pass the GUID (stable across renames) or just `shared`.
>
> **Ve zkratce.** `-Identity` hledá seznam podle title, GUID nebo **web-relativní** URL – server-relativní cesta typu `/sites/team/shared` se nikdy netrefí a spadne na „List does not exist", i když seznam prokazatelně existuje; předej GUID (přežije přejmenování) nebo prostě `shared`.

## Symptom

```powershell
Connect-PnPOnline -Url 'https://contoso.sharepoint.com/sites/team' ...
Get-PnPList -Identity '/sites/team/shared'
```

```text
Get-PnPList: List '/sites/team/shared' does not exist at site with URL
'https://contoso.sharepoint.com/sites/team'.
```

The list exists, the connection is fine, permissions are fine. The error reads like a permissions or wrong-site problem and sends you checking both.

## Cause

`ListPipeBind` resolution accepts three shapes: display title, list Id (GUID), and a URL **relative to the connected web** (`shared`, `Lists/Tasks`). A server-relative path is a fourth shape it does not try — natural to reach for, because that is exactly what SharePoint REST returns in `RootFolder/ServerRelativeUrl` and what half the REST endpoints want.

## Fix

Prefer the GUID — it survives both renames and re-connects:

```powershell
$list = Get-PnPList -Identity '00000000-0000-0000-0000-000000000000'
```

Or strip the web part of the path and pass the web-relative remainder:

```powershell
$list = Get-PnPList -Identity 'shared'
```

## Notes

- `Add-PnPFile -Folder` has the same appetite: web-relative (`shared`), not server-relative (`/sites/team/shared`).
- The REST counterpart trap is the mirror image — REST's `GetList(@u)` wants exactly the server-relative form. Copying identifiers between the two worlds is where this bites.
- Related (REST flavour of "resolve lists robustly"): [Get lists by URL, not by title](../rest-api/get-list-by-url-not-by-title.md).
