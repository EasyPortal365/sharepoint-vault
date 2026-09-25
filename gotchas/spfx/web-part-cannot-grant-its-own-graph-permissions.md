---
title: "A \"grant it for me\" button cannot work in a web part — not even for a Global Administrator"
short-title: "No \"grant it for me\" button in a web part"
summary: "A delegated call gets the intersection of the user's rights and the app's grants, so the admin at the keyboard adds nothing; writing the grant would take at least `DelegatedPermissionGrant.ReadWrite.All` approved for the principal every SPFx solution shares, and approval runs on the admin site. Give the admin the path instead: API access first, a script second, and what the approval does not guarantee"
tags: [spfx, graph, permissions, api-access, admin-consent, diagnostics]
applies-to: SharePoint Online, SPFx (MSGraphClientV3 / AadHttpClient, delegated permissions)
last-reviewed: 2026-09-25
---

# A "grant it for me" button cannot work in a web part — not even for a Global Administrator

> **Bottom line.** A web part can neither approve nor grant its own Graph permissions, whoever sits at the keyboard. A delegated call gets the intersection of the user's rights and the scopes approved for the application, so a Global Administrator adds nothing the grant lacks. Writing the grant itself would take at least `DelegatedPermissionGrant.ReadWrite.All`, approved for the principal that every SPFx solution in the tenant shares — a circle with a tenant-wide blast radius — and the approval runs on the admin site, another origin. Give the administrator a ready path instead: the API access page first, a script second, and a plain statement of what the approval does not guarantee.
>
> **Ve zkratce.** Webpart si oprávnění Graphu sám neschválí ani neudělí – ať u klávesnice sedí kdokoli. Delegované volání dostane průnik práv uživatele a oprávnění schválených aplikaci, takže Global Administrator nepřidá nic, co v grantu chybí. Zapsat grant by vyžadovalo přinejmenším `DelegatedPermissionGrant.ReadWrite.All` schválené pro principál, který sdílí všechna SPFx řešení v tenantu – kruh s dopadem na celý tenant – a schvalování navíc běží na admin webu, na jiném originu. Místo tlačítka dejte správci hotový postup: nejdřív stránku API access, potom skript, a k tomu jasně, co schválení nezaručuje.

## Symptom

Our diagnostics page measures which delegated Graph permissions really work for the signed-in user — one light call per scope — and flags the ones that fail. The natural next step is a button next to the red row: *Grant it for me*. The person reading the page is often a Global Administrator, the role Microsoft names for approving Microsoft Graph requests on the API access page, so it looks as if the web part could simply do it on their behalf.

It cannot, and a stronger role would not change that.

## Cause

Three reasons, and each closes a different route.

**1. Delegated access is an intersection.** SPFx gets its Graph tokens through the *SharePoint Online Client Extensibility* principal. For delegated permissions, Microsoft's rule is that the app cannot reach anything the signed-in user couldn't, and that what it may do is decided by the permissions granted to *the app* **and** by the user's own rights. A Global Administrator widens the second set, never the first: the token carries only the scopes approved for the principal, so whatever the grant lacks, the administrator's calls lack too.

**2. Writing a grant takes a grant that can hand out all the others.** An approved SPFx permission is a permission grant on that principal — `Get-SPOTenantServicePrincipalPermissionGrants` lists it with the fields of a delegated permission grant (`oAuth2PermissionGrant`): client, resource, consent type and scope. Creating or updating one through Graph needs `DelegatedPermissionGrant.ReadWrite.All` — the right to manage delegated grants for any API, Microsoft Graph included — and that is the *least* privileged option Graph offers for it. For the web part to hold that scope, someone would first have to approve it for the SharePoint Online Client Extensibility principal, and that principal is shared: Microsoft documents that what is granted to it applies to the entire tenant and can be used by any client-side request there, SPFx or not. From then on every SPFx solution in the tenant could write delegated permission grants for any API, Microsoft Graph included, whenever a user holding one of the roles Graph lists for that operation (Application Administrator or Cloud Application Administrator, for example) opens its page. To be allowed to grant, you first need someone to approve a permission that can hand out every other delegated permission: a circle with a tenant-wide blast radius. The write is also easy to get wrong in the worst possible way — a `PATCH` whose `scope` leaves out the existing values replaces them, for every solution at once. Don't request that scope.

**3. The approval lives somewhere else.** The API access page belongs to the SharePoint admin center, and the approval cmdlets run over a connection to the same admin site (`Connect-SPOService -Url https://contoso-admin.sharepoint.com`). That is a different origin from the site the web part runs on, and not one the web part has a token for. Microsoft also states that the principal is fully controlled by SharePoint through the API access page and that changing it directly in the Microsoft Entra admin center is unsupported; a web part writing grants through Graph would likewise bypass that page.

## Fix

Don't build the button — build the path. The row that reports a missing permission should carry everything the administrator needs, in this order.

**1. The admin center first.** Most administrators will click long before they install a PowerShell module. Link straight to **SharePoint admin center → Advanced → API access**, where they select the pending request and choose **Approve**. Microsoft's own link to that page (the target of the link in the API access documentation) is `https://admin.microsoft.com/sharepoint?page=webApiPermissionManagement&modern=true`; it names no tenant, so the tenant comes from the administrator's sign-in. A link derived from the site the web part runs on pins the tenant — the deep link below is the form PnP community samples publish:

```ts
// contoso.sharepoint.com (or contoso-my.sharepoint.com) -> contoso-admin.sharepoint.com
const host = new URL(this.context.pageContext.web.absoluteUrl).hostname;
const adminHost = host.replace(/^([^.]+?)(?:-my)?\./, '$1-admin.');
const apiAccessUrl = `https://${adminHost}/_layouts/15/online/AdminHome.aspx#/webApiPermissionManagement`;
```

Say who can do it right there: for Microsoft Graph, the API access documentation requires a Global Administrator ([Approving Graph permissions for SPFx needs a Global Administrator](../permissions/graph-api-access-approval-needs-global-admin.md)).

**2. A script second, for whoever wants it written down.** Lead with the official SharePoint Online Management Shell — it signs in interactively without an app registration of your own:

```powershell
Connect-SPOService -Url https://contoso-admin.sharepoint.com

# A pending request exists: approve it by its id
$req = Get-SPOTenantServicePrincipalPermissionRequests |
    Where-Object { $_.Resource -eq 'Microsoft Graph' -and $_.Scope -eq 'Calendars.Read' } |
    Select-Object -First 1
if ($req) { Approve-SPOTenantServicePrincipalPermissionRequest -RequestId $req.Id }

# No request at all (rejected earlier, or never raised): add the grant directly
Approve-SPOTenantServicePrincipalPermissionGrant -Resource 'Microsoft Graph' -Scope 'Calendars.Read'
```

Check `Get-SPOTenantServicePrincipalPermissionGrants` first: SharePoint does not verify whether a requested permission is already granted, and approving a request for one that is ends in an error.

PnP.PowerShell reaches the same place (`Approve-PnPTenantServicePrincipalPermissionRequest`, `Grant-PnPTenantServicePrincipalPermission`), but since 9 September 2024 it needs your own Entra ID app registration, passed as `-ClientId` or through the `ENTRAID_APP_ID` environment variable, and PnP lists `Directory.ReadWrite.All` on Microsoft Graph among the grant cmdlet's requirements. Offer it as the alternative, not the default — at a customer, every extra prerequisite is a place where the procedure stops.

```powershell
Connect-PnPOnline -Url https://contoso-admin.sharepoint.com -Interactive -ClientId $clientId
Grant-PnPTenantServicePrincipalPermission -Resource 'Microsoft Graph' -Scope 'Calendars.Read'
```

**3. Say what the approval does not guarantee** — next to the instructions, not in a footnote:

- **It is not granted to this web part.** It lands on the shared principal, so every SPFx solution in the tenant gets it too, and removing your solution revokes nothing. Removing it on the API access page, in turn, affects every solution that relies on it ([Graph grants are tenant-wide](graph-permission-grants-are-tenant-wide.md)).
- **It does not guarantee results.** The user's own rights and data still decide what comes back: an account without a mailbox gets no mail however many scopes are approved ([no mailbox vs. no consent](../graph/mail-probe-no-mailbox-vs-no-consent.md)), and a Graph search can return 0 hits without anything failing ([Graph Search returns 0 hits](../search/graph-search-raw-question-returns-nothing.md)).
- **It does not reach a token that already exists.** A token issued before the approval does not carry the new scope, so measure again after a page reload or a fresh sign-in.

## Notes

- Domain-isolated web parts, whose permissions are listed under *Isolated* on the API access page, were the one exception to the shared principal. Microsoft's retirement schedule switched them off for existing tenants on 2 April 2026, so organization-wide is the only kind left.
- The Entra admin center is fine for *looking* at the principal's permissions. Changing them there is unsupported according to Microsoft; keep approvals on the API access page or in the SharePoint cmdlets.

## References

- [Overview of Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-overview) — *Delegated permissions*: the app can't access anything the signed-in user couldn't; its privileges come from its own permissions and the user's.
- [Create oAuth2PermissionGrant](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-post?view=graph-rest-1.0) and [Update an oAuth2PermissionGrant](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-update?view=graph-rest-1.0) — `DelegatedPermissionGrant.ReadWrite.All` is the least privileged permission, and the roles the signed-in user needs; an update that leaves out the existing scopes overwrites them.
- [Microsoft Graph permissions reference: `DelegatedPermissionGrant.ReadWrite.All`](https://learn.microsoft.com/en-us/graph/permissions-reference#delegatedpermissiongrantreadwriteall) — manages delegated grants for any API; admin consent required.
- [Connect to Entra ID-secured APIs in SharePoint Framework solutions](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/use-aadhttpclient) — *Considerations*: grants apply to the entire tenant, removing the solution doesn't revoke them, the principal is fully controlled through the API access page and direct changes in the Microsoft Entra admin center are unsupported; *Manage permissions with PowerShell*: approving an already granted permission errors.
- [Manage access to Microsoft Entra ID-secured APIs](https://learn.microsoft.com/en-us/sharepoint/api-access) — the API access page, the Global Administrator requirement for Microsoft Graph, the PowerShell cmdlets.
- [Get-SPOTenantServicePrincipalPermissionGrants](https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/get-spotenantserviceprincipalpermissiongrants?view=sharepoint-ps), [Approve-SPOTenantServicePrincipalPermissionRequest](https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/approve-spotenantserviceprincipalpermissionrequest?view=sharepoint-ps), [Approve-SPOTenantServicePrincipalPermissionGrant](https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/approve-spotenantserviceprincipalpermissiongrant?view=sharepoint-ps) and [Connect-SPOService](https://learn.microsoft.com/en-us/powershell/module/microsoft.online.sharepoint.powershell/connect-sposervice?view=sharepoint-ps) — the fields of a grant; a grant without a pending request; interactive sign-in to the admin center, `-ClientId` only for an app identity with a certificate.
- [Register an Entra ID Application to use with PnP PowerShell](https://pnp.github.io/powershell/articles/registerapplication.html), [Connect-PnPOnline](https://pnp.github.io/powershell/cmdlets/Connect-PnPOnline.html) and [Grant-PnPTenantServicePrincipalPermission](https://pnp.github.io/powershell/cmdlets/Grant-PnPTenantServicePrincipalPermission.html) — own app registration required since 9 September 2024; `Directory.ReadWrite.All` for the grant cmdlet.
- [PnP sample *react-check-user-group*](https://github.com/pnp/sp-dev-fx-webparts/tree/main/samples/react-check-user-group) — one of the community samples that send the administrator to API access through the `AdminHome.aspx#/webApiPermissionManagement` deep link.
- [Isolated web parts retirement](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/web-parts/isolated-web-parts-retirement) — switched off for existing tenants on 2 April 2026.
