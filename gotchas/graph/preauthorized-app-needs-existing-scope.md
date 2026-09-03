---
title: preAuthorizedApplications can't reference a scope created in the same PATCH
tags: [graph, entra-id, app-registration, api, scripting]
applies-to: Microsoft Graph v1.0 (/applications), Azure CLI, Microsoft Graph PowerShell SDK
last-reviewed: 2026-09-03
---

# `preAuthorizedApplications` can't reference a scope created in the same PATCH

> **Bottom line.** Graph validates `api.preAuthorizedApplications[].delegatedPermissionIds` against the scopes **already stored on the object**, not against the ones in the same request body. Defining a scope and pre-authorizing it in one `PATCH` returns HTTP 400. Split it into two calls: scope first, reference second.
>
> **Ve zkratce.** Graph ověřuje `api.preAuthorizedApplications[].delegatedPermissionIds` proti scopes, které jsou na objektu **už uložené**, ne proti těm ze stejného těla. Založit scope a zároveň ho preautorizovat jedním `PATCH` skončí na HTTP 400. Rozděl to na dvě volání: nejdřív scope, pak odkaz.

## Symptom

A setup script configures a custom API in one shot — identifier, scope, and pre-authorization of a client:

```jsonc
PATCH https://graph.microsoft.com/v1.0/applications/{objectId}
{
  "identifierUris": ["api://<tenantId>/my-api"],
  "api": {
    "requestedAccessTokenVersion": 2,
    "oauth2PermissionScopes": [
      { "id": "<new-guid>", "value": "user_impersonation", "type": "User", "isEnabled": true, … }
    ],
    "preAuthorizedApplications": [
      { "appId": "<client-app-id>", "delegatedPermissionIds": ["<new-guid>"] }
    ]
  }
}
```

Graph answers **400**:

```json
{ "error": { "code": "InvalidValue",
  "message": "Property api.preAuthorizedApplications.delegatedPermissionIds has a Permission Id that cannot be found in the AppPermissions sets." } }
```

The GUID in `delegatedPermissionIds` is the very one two lines above it.

## Cause

The validator resolves permission ids against the application object **as currently persisted**. Properties in the request body are not visible to it, so a scope being created in the same call does not exist yet as far as the check is concerned.

## Fix

Two `PATCH` calls, in order:

```powershell
$scopeId = [guid]::NewGuid().ToString()

# 1) identifier + scope
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$objectId" `
        --headers 'Content-Type=application/json' --body "@step1.json"

# 2) only now the pre-authorization that points at $scopeId
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$objectId" `
        --headers 'Content-Type=application/json' --body "@step2.json"
```

A short pause between them (a few seconds) avoids replication flakiness on a freshly created registration.

## Scope of the rule

The same ordering applies to anything referencing another part of the same object by id, notably `appRoles` referenced from role assignments. When a script builds an object and immediately points at a piece of it, assume the reference needs a separate call.

Nothing catches this at review time — the body looks self-consistent and any JSON schema check passes. It only surfaces on the first live run, which is usually at a customer. Put the reason in a comment next to the split, or somebody will "tidy" the two calls back into one.

## Idempotence note

Re-running the script must **reuse the existing scope id**, not generate a new one — otherwise every run redefines the permission and any approval granted against the old id stops matching:

```powershell
$existing = (az rest --method GET --uri "https://graph.microsoft.com/v1.0/applications/$objectId" | ConvertFrom-Json).api.oauth2PermissionScopes |
            Where-Object { $_.value -eq 'user_impersonation' } | Select-Object -First 1
$scopeId = if ($existing) { $existing.id } else { [guid]::NewGuid().ToString() }
```

## Related

- ["The requested permission isn't valid" in API access](../spfx/custom-api-permission-request-invalid.md) — the SPFx side of the same setup.
