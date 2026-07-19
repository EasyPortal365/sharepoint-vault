---
title: az CLI can't grant Sites.Selected — the scope is blocked by AADSTS65002
tags: [graph, permissions, sites, azure-cli, powershell]
applies-to: Microsoft Graph, Azure CLI, Microsoft Graph PowerShell SDK
last-reviewed: 2026-07-19
---

# az CLI can't grant Sites.Selected — the scope is blocked by `AADSTS65002`

> **Bottom line.** Granting an app Sites.Selected permission on a site (`POST`/`PATCH /sites/{id}/permissions`) needs the delegated `Sites.FullControl.All` scope, and the first-party Azure CLI client isn't authorized to request it — `az login --scope …Sites.FullControl.All` dies with `AADSTS65002`. Use the Microsoft Graph PowerShell SDK (or PnP) instead; its own client app *is* preauthorized for that scope.
>
> **Ve zkratce.** Udělení oprávnění Sites.Selected aplikaci na konkrétním webu (`POST`/`PATCH /sites/{id}/permissions`) vyžaduje delegovaný scope `Sites.FullControl.All` a first-party klient Azure CLI ho požádat nesmí – `az login --scope …Sites.FullControl.All` spadne na `AADSTS65002`. Použij místo něj Microsoft Graph PowerShell SDK (nebo PnP); jeho vlastní klientská aplikace pro ten scope preautorizovaná je.

## Symptom

You script the Sites.Selected grant (give an app read/write to *specific* site collections only) through the Azure CLI:

```bash
az rest --method POST \
  --uri "https://graph.microsoft.com/v1.0/sites/{site-id}/permissions" \
  --body '{ "roles": ["write"], "grantedToIdentities": [ { "application": { "id": "<app-id>", "displayName": "<app>" } } ] }'
```

It returns **403**. So you try to acquire the scope explicitly first:

```bash
az login --scope https://graph.microsoft.com/Sites.FullControl.All
```

and that fails at sign-in with:

> AADSTS65002: The client application '04b07795-8ddb-461a-bbee-02f9e1bf7b46' is not authorized to request an access token for the resource ...

The same failure happens everywhere — a normal workstation login *and* Azure Cloud Shell.

## Cause

Writing to `/sites/{id}/permissions` (the Sites.Selected grant surface) requires the delegated **`Sites.FullControl.All`** scope. The first-party **Azure CLI** client (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) does not list that scope among its pre-authorized permissions, and Microsoft **won't let it request one** — hence the hard `AADSTS65002` (a preauthorization lockdown) rather than an ordinary consent prompt. No amount of tenant-admin consent changes this: it's a property of *that client app*, not of your account.

In Cloud Shell there's a second reason the obvious path fails — the implicit managed-identity token has the wrong audience for Graph, so you can't lean on it either.

## Fix

Use the **Microsoft Graph PowerShell SDK**. Its client application *is* preauthorized for `Sites.FullControl.All`, and device-code auth works in Cloud Shell too:

```powershell
Connect-MgGraph -Scopes "Sites.FullControl.All" -UseDeviceCode

# Resolve the site by host + server-relative path:
$site = Get-MgSite -SiteId "contoso.sharepoint.com:/sites/projects"

# Grant the app read (or write) to just this site:
New-MgSitePermission -SiteId $site.Id -BodyParameter @{
  roles               = @('read')     # or 'write'
  grantedToIdentities = @(@{ application = @{ id = '<app-client-id>'; displayName = '<app-name>' } })
}

# Later, widen an existing grant's role:
Update-MgSitePermission -SiteId $site.Id -PermissionId '<permission-id>' -BodyParameter @{ roles = @('write') }
```

`-UseDeviceCode` sidesteps the Cloud Shell MSI-audience problem. PnP.PowerShell's `Grant-PnPAzureADAppSitePermission` is a valid alternative, but carries a heavier prerequisite (its own Entra app registration).

## Notes

- General rule: when `az rest` hits Graph and `az login --scope <X>` returns `AADSTS65002`, it's **not** an account-permission problem — it means the CLI's first-party client isn't allowed to hold scope `<X>`. Switch tools (Graph SDK / PnP) instead of chasing consent.
- `AADSTS65002` = "client application is not authorized" / preauthorization. Distinct from `AADSTS65001` (user or admin hasn't consented), which *can* be resolved by granting consent.
- Sites.Selected itself is the good pattern — least-privilege, per-site app access instead of tenant-wide `Sites.Read.All` / `Sites.ReadWrite.All`. Only the *granting tool* is the trap.
