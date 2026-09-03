---
title: "\"The requested permission isn't valid\" in API access — the API registration doesn't exist yet"
tags: [spfx, permissions, entra-id, app-registration, api-access, aadhttpclient]
applies-to: SharePoint Framework 1.x, SharePoint admin center, Microsoft Entra ID
last-reviewed: 2026-09-03
---

# "The requested permission isn't valid" in API access — the API registration doesn't exist yet

> **Bottom line.** When a `.sppkg` requests a scope on your *own* API, SharePoint resolves `resource` to a **service principal in the tenant**. If the app registration hasn't been created yet, the pending request is rejected as invalid — and the message blames the package, not the missing registration. Create the registration **before** uploading the package.
>
> **Ve zkratce.** Když balíček žádá o scope na *vlastním* API, SharePoint hledá podle `resource` **service principal v tenantu**. Pokud registrace ještě nevznikla, označí čekající žádost za neplatnou – a hláška svádí na vadu balíčku, ne na chybějící registraci. Registraci zakládej **dřív**, než nahraješ balíček.

## Symptom

`package-solution.json` asks for a scope on a custom API:

```json
"webApiPermissionRequests": [
  { "resource": "Contoso AI Function", "scope": "user_impersonation" }
]
```

The package uploads fine. In **SharePoint admin center → Advanced → API access** the request is listed with the right API name and scope, but a red banner says:

> The requested permission isn't valid. Reject this request and contact the developer to fix the problem and redeploy the solution.

Approve does nothing. The package is fine, and redeploying it changes nothing.

## Cause

SharePoint resolves `resource` against **service principals that exist in the tenant** — by display name, or by App ID URI. A custom API only has one after somebody registers it (and creates its service principal). Until then there is nothing to grant, so the request is reported as invalid.

The wording sends you to the developer, but the fault is in the **order of the deployment steps**: the package was uploaded before the registration script ran. This is easy to get backwards, because with Microsoft Graph — where the service principal always exists — uploading first works.

## Fix

Create the registration first, then upload the package:

```powershell
# 1. registration + service principal (service principal is what SharePoint looks for)
az ad app create --display-name "Contoso AI Function" --sign-in-audience AzureADMyOrg
az ad sp create --id <appId>

# 2. only now upload the .sppkg, then approve in API access
```

If the invalid request is already sitting there, **Reject** it, create the registration and upload the package again — that queues a fresh request, which approves normally.

### Verify the cause before changing anything

```powershell
az rest --method GET --uri "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=displayName eq 'Contoso AI Function'"
```

An empty `value` array confirms it. If the principal *does* exist, the problem is elsewhere — usually `resource` not matching the display name or App ID URI exactly, or the scope name not existing on the API.

## Also worth knowing

- **The registration for a pure API needs no secret and no certificate.** It exists only so tokens have an audience. Nothing expires and nothing rotates — unlike an app-only identity that reads data.
- **Pre-authorize the SharePoint Framework principal** (`08e18876-6177-487e-b8b5-cf950c1e598c`, the same id in every tenant), otherwise SharePoint will not issue the token even after the grant is approved.
- **An App ID URI shaped `api://<tenantId>/<fixed-suffix>`** lets the client derive the resource from `pageContext.aadInfo.tenantId`, so the identifier need not be configured anywhere and one `.sppkg` fits every tenant. The default `api://<appId>` cannot be derived and forces a per-customer setting.
- Adding `Authorization` to calls that were previously plain `GET`s makes them non-simple requests, so the server must now answer a CORS preflight with `GET` in `Access-Control-Allow-Methods` and `Authorization` in `Access-Control-Allow-Headers`.

## Related

- [Graph permission grants are tenant-wide](graph-permission-grants-are-tenant-wide.md) — approvals in API access attach to a shared principal, so they apply to every SPFx solution in the catalog.
- [preAuthorizedApplications rejected in the same PATCH as the scope](../graph/preauthorized-app-needs-existing-scope.md) — the next trap when scripting this registration.
