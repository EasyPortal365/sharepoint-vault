---
title: A Graph scope your SPFx solution never asked for may already work — grants are tenant-wide
tags: [spfx, graph, permissions, deployment]
applies-to: SharePoint Online
last-reviewed: 2026-09-04
---

# Graph permission grants belong to the tenant, not to your solution

> **Bottom line.** `webApiPermissionRequests` in `package-solution.json` is a **request**, not a grant. What an administrator approves lands on one tenant-wide service principal — *SharePoint Online Client Extensibility Web Application Principal* — so every SPFx component in that tenant inherits it. A scope another solution had approved works in yours before you deploy anything; a scope only *your* dev tenant has will be missing at the customer.
>
> **Ve zkratce.** `webApiPermissionRequests` je jen žádost. Schválené oprávnění dostane jeden tenant-wide servisní principál, takže ho zdědí všechny SPFx komponenty v tenantu — i ta, která o něj nikdy nepožádala. U zákazníka naopak může chybět.

## Symptom

The surprising direction: something works that should not yet.

You add a Graph call needing a scope your solution does not declare, bump the package, and prepare to tell everyone the feature stays dormant until an admin approves it in **SharePoint admin center → Advanced → API access**. Then you test — and the call returns `200` on the first try, with the *old* package still deployed.

The mirror image is the one that hurts: the same code ships to a customer whose tenant never approved that scope, and the feature fails there with `403` while "working fine in our tenant" for months.

## Cause

Delegated permissions for SPFx are not granted per solution. The approval is recorded against the tenant's **SharePoint Online Client Extensibility Web Application Principal**, and every SPFx web part, extension or library in the tenant requests its Graph token through that same principal. Consequences:

- A scope approved for solution **A** is silently available to solutions **B** and **C**.
- Your `webApiPermissionRequests` entry only makes the request *appear* in API access for approval. Removing it does not revoke anything.
- `AadHttpClient` / `MSGraphClient` therefore succeed or fail based on the tenant's aggregate grants, never on your manifest.

## What to do

- **Declare the scope anyway.** It documents the dependency and it is what makes the request visible on a fresh tenant. Just do not treat the declaration as the thing that switches the feature on.
- **Decide rollout by a live test on the target tenant**, not by reading your own manifest. One call from the app is worth more than any amount of manifest review.
- **Keep a fail-safe branch for the missing grant, and make it visible.** On a clean tenant this is the only thing that separates "no permission" from "no data" — silently returning an empty result turns a consent problem into a phantom bug. Surface the real error text; a `403` may equally mean a licensing gate, not a missing scope.
- **Audit the other direction too.** Because a foreign grant can carry your code, an app may be running on a scope it never declared — and break at the first customer who has a tidier tenant. When a feature depends on Graph, verify the scope is actually in your manifest even though everything works.
- Practical upside in a versioned-runtime setup: adding a scope does not block a release. The package carrying the new request can be uploaded later; until then the feature runs wherever the grant already exists.

## The request only appears if the package version changed

Measured on a live tenant, 2026-09-04. Adding a scope to a solution that is **already deployed** and re-uploading the package **without bumping `solution.version`** produces **no request at all** in API access. The App Catalog treats a same-version upload as a replacement, not an upgrade, so nothing new is ever surfaced for approval.

That combines badly with the tenant-wide rule above, because the two failure modes look identical from your desk:

- The scope was already granted for another solution, so no request appears — and everything works.
- The version did not change, so no request appears — and nothing works on a tenant that lacks the grant.

**Check the grant before concluding anything from a missing request.** If `Microsoft Graph / <scope>` is already listed as approved in API access, you are in the first case and there is nothing to do. If it is not, bump `solution.version` and upload again, or grant the scope directly:

```powershell
Connect-PnPOnline -Url "https://<tenant>-admin.sharepoint.com" -Interactive
Grant-PnPTenantServicePrincipalPermission -Scope "GroupMember.Read.All" -Resource "Microsoft Graph"
```

The official SPO Management Shell can only approve a request that already exists (`Approve-SPOTenantServicePrincipalPermissionRequest`); it cannot create a grant from nothing, which is why PnP is used here. The clickable equivalent is Entra ID → Enterprise applications → *SharePoint Online Client Extensibility Web Application Principal* → Permissions → grant admin consent.

## Notes

- Same mechanics apply to extensions and library components — anything shipped as SPFx.
- Approval is per tenant, so a dev tenant that accumulated scopes over years is a poor proxy for a customer's. Keep a note of which scopes each solution genuinely needs.
- Nothing here applies to app-only permissions, which live on their own app registration.
