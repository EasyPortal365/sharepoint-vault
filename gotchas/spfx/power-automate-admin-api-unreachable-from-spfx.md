---
title: "Power Automate admin flows API returns UserImpersonationScopeMissing from SPFx – even after you approve the scope"
short-title: Power Automate admin API is unreachable from SPFx
summary: SharePoint's token for Microsoft Flow Service carries only Microsoft's preauthorized scopes, so an approved `User` grant never reaches the token and the tenant-wide flows list stays 401
tags: [spfx, power-automate, power-platform, api-access, aadtokenprovider, entra-id]
applies-to: SharePoint Framework 1.x (AadTokenProviderFactory), Power Automate admin API (api.flow.microsoft.com), Microsoft Entra ID
last-reviewed: 2026-10-30
---

# Power Automate admin flows API returns UserImpersonationScopeMissing from SPFx – even after you approve the scope

> **Bottom line.** A token that SPFx gets for `https://service.flow.microsoft.com/` is issued to the first-party client *SharePoint Online Web Client Extensibility* and carries only the scopes Microsoft preauthorized for it (`Flows.Read.All`, `Flows.Install`, `Approvals.Manage.All`, …). The admin endpoint `…/Microsoft.ProcessSimple/scopes/admin/environments/{env}/v2/flows` wants the delegated scope **`User`**. You can request it in `webApiPermissionRequests` and approve it in API access – the grant then exists in Entra ID – but it **never appears in the token**. The tenant-wide flow list is not reachable from a SharePoint page; collect it outside the browser (PowerShell `Get-AdminFlow`, or a backend with its own app registration).
>
> **Ve zkratce.** Token, který SPFx dostane pro `https://service.flow.microsoft.com/`, patří first-party klientovi *SharePoint Online Web Client Extensibility* a nese jen scopy, které mu Microsoft předem povolil. Admin výpis toků chce delegovaný scope **`User`**. Můžete o něj v balíčku požádat a v Přístupu k API ho schválit – grant v Entra ID pak existuje – ale do tokenu se **nikdy nedostane**. Výpis toků celého tenantu ze stránky SharePointu nezískáte; sbírejte ho mimo prohlížeč (PowerShell `Get-AdminFlow` nebo backend s vlastní registrací aplikace).

## Symptom

The package requests the scope:

```json
"webApiPermissionRequests": [
  { "resource": "Microsoft Flow Service", "scope": "User" }
]
```

The admin approves it in **SharePoint admin center → Advanced → API access**. Entra ID shows the delegated grant `User` (consent type `AllPrincipals`) on the *SharePoint Online Web Client Extensibility* service principal, and the directory audit log has an *Add delegated permission grant* entry for *Microsoft Flow Service*.

The SPFx call still fails for a Global or Power Platform administrator:

```
GET https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/scopes/admin/environments/{env}/v2/flows?api-version=2016-11-01
401 UserImpersonationScopeMissing
```

## What the token actually contains

Decode the token SPFx hands out (it does not matter whether you ask for `https://service.flow.microsoft.com/`, without the slash, or by the app ID `7df0a125-d3be-4c96-aa54-591f83ff541c`):

```text
appid = 08e18876-6177-487e-b8b5-cf950c1e598c   (SharePoint Online Web Client Extensibility)
scp   = Approvals.Manage.All Flows.Install Flows.Read.All Flows.Read.Plans Flows.Write.Plans
```

`User` is missing although the grant exists, and it stays missing after the cached token expires. Approving more scopes in API access does not change it. `https://api.flow.microsoft.com/` as a resource is blocked outright (`AADSTS500011`).

## What does work from SPFx

- **The user's own flows:** `GET …/Microsoft.ProcessSimple/environments/{env}/flows?api-version=2016-11-01` returns 200 with the preauthorized `Flows.Read.All`, but only for flows the signed-in user owns or co-owns, not the whole tenant.
- **Environments, DLP policies, apps, connections:** `api.bap.microsoft.com` and `service.powerapps.com` tokens carry `user_impersonation` (preauthorized), so the admin endpoints work for a Power Platform or Global administrator.

## What to do instead

- **PowerShell collector:** the administrator runs `Get-AdminFlow` (module *Microsoft.PowerApps.Administration.PowerShell*) and imports the result as a snapshot.
- **Backend:** a service with its own app registration, registered for Power Platform admin access (`New-PowerAppManagementApp`), calls the admin API.
- Do **not** ship the `Microsoft Flow Service – User` request in a package. Admins will approve a permission that has no effect, and your UI will keep telling them to approve something they already approved.

## How to check it on your tenant

In the browser console on any modern SharePoint page:

```js
const L = window._spComponentLoader;
const http = await L.loadComponentById('c07208f0-ea3b-4c1a-9965-ac1b825211a6');
const core = await L.loadComponentById('7263c7d0-1d6a-45ec-8d85-d4d1d234171b');
const scope = core.ServiceScope.startNewRoot(); scope.finish();
const p = await scope.consume(http.AadTokenProviderFactory.serviceKey).getTokenProvider();
const t = await p.getToken('https://service.flow.microsoft.com/', false);
JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).scp;
```
