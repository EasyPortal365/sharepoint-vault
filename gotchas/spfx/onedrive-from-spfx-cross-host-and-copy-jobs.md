---
title: Moving OneDrive files into SharePoint from an SPFx app – start the copy job on the destination site
short-title: OneDrive to SharePoint from SPFx
summary: "An SPFx page on `<tenant>.sharepoint.com` cannot call `<tenant>-my.sharepoint.com` (CORS) and cannot get a SharePoint token, but `CreateCopyJobs` called on the DESTINATION site accepts a OneDrive source and keeps version history and dates; granting an admin access to someone else's OneDrive is not possible from the browser (Tenant CSOM only on -admin) and needs an app-only identity"
tags: [spfx, onedrive, copy-move-api, cors, migration]
applies-to: SharePoint Online, OneDrive for Business, SharePoint Framework
last-reviewed: 2026-11-27
---

# OneDrive → SharePoint from an SPFx app

> **Bottom line.** Your SPFx code runs on `<tenant>.sharepoint.com` and the browser will not let it call `<tenant>-my.sharepoint.com` at all. You do not need to: the Copy/Move API (`/_api/site/CreateCopyJobs`) works when you call it on the **destination** site with an absolute OneDrive URL as the source. The copy keeps the version history and the original Created/Modified. What stays out of reach is access: a global admin cannot read another person's OneDrive until they are made its site collection admin, and the app cannot do that from the browser. That step needs an app-only identity.
>
> **Ve zkratce.** Appka na `<tenant>.sharepoint.com` na OneDrive (`-my`) přímo nedosáhne, ale kopii lze spustit na cílovém webu se zdrojem v OneDrivu – přenese verze i časy. Do cizího OneDrivu ale správce bez přidělení přístupu nevidí a appka mu ho z prohlížeče neudělí – na to je potřeba app-only identita.

## What was measured

All four results come from a live tenant (November 2026), with test folders deleted afterwards.

| Test | Result |
|---|---|
| `fetch('https://<tenant>-my.sharepoint.com/.../_api/web', { credentials: 'include' })` from a page on `<tenant>.sharepoint.com` | `TypeError: Failed to fetch` (CORS) – for your own OneDrive as well as someone else's |
| `POST /_api/SP.OAuth.Token/Acquire` with `resource` = `https://<tenant>-my.sharepoint.com` or `https://<tenant>.sharepoint.com` | `400` – `Resource is not allowed.` |
| `POST <destination site>/_api/site/CreateCopyJobs` with a OneDrive file in `exportObjectUris` and a SharePoint folder as `destinationUri` | `200`. `GetCopyJobProgress` on the same site reached `JobState: 0` in about 2 s. The file arrived as version 3.0 with history 1.0 and 2.0, and with the original Created/Modified |
| `GET /personal/<someone>/_api/web` as a global admin | `403 UnauthorizedAccessException`. The same admin gets `200` on the `-my` root |

The request body used for the copy test:

```json
{
  "exportObjectUris": ["https://<tenant>-my.sharepoint.com/personal/<user>/Documents/<folder>/file.txt"],
  "destinationUri": "https://<tenant>.sharepoint.com/sites/<site>/Shared Documents/<folder>",
  "options": {
    "IgnoreVersionHistory": false,
    "IsMoveMode": true,
    "MoveButKeepSource": true,
    "AllowSchemaMismatch": true,
    "AllowSmallerVersionLimitOnDestination": true,
    "NameConflictBehavior": 0
  }
}
```

## What it means for an app

- **Run the copy from the destination side.** Call `CreateCopyJobs` and `GetCopyJobProgress` on the destination site. That request is same-origin, so `SPHttpClient` handles it.
- **Do not plan on REST calls to `-my` for listing files.** Neither cookies nor an SPFx-issued SharePoint token get there. Use Microsoft Graph over the user's drive instead (measured below).
- **Admin access to another person's OneDrive is a separate step.** The copy runs with the caller's permissions, so the admin must first be added as site collection admin of that OneDrive. In the Microsoft 365 admin center this is **Users › Active users › (user) › OneDrive › Get access to files › Create link to files**. The same page notes that a manual **Move to** / **Copy to** moves only the latest version, so the copy job above is the way to keep the history ([Microsoft Learn: Give another employee access to OneDrive and Outlook data](https://learn.microsoft.com/microsoft-365/admin/add-users/remove-former-employee-step-5)). The SharePoint admin API lives on the `-admin` host, which is another origin, so the app cannot grant this access from the browser. It can only point the admin to the setting and check the result by reading.

## Can the app grant itself access? Not from the browser

Measured as a global admin on a page on `<tenant>.sharepoint.com` (read-only calls):

| Attempt | Result |
|---|---|
| Tenant CSOM on the root site: `POST /_vti_bin/client.svc/ProcessQuery` with a `Constructor` of TypeId `{268004ae-ef6b-4e9b-8425-127220d84719}` (the `Tenant` class) and a query for `SharingCapability` | `200` with `ErrorInfo`: `Current site is not a tenant administration site.` (`SpoException`). `Tenant.SetSiteAdmin` is therefore out of reach from any regular site |
| `fetch('https://<tenant>-admin.sharepoint.com/_api/contextinfo', { method: 'POST', credentials: 'include' })` | `TypeError: Failed to fetch` (CORS) |
| `POST /_api/SP.OAuth.Token/Acquire` with `resource` = `https://<tenant>-admin.sharepoint.com` | `400` – `Resource is not allowed.` |

Delegated Microsoft Graph does not help either: with delegated permissions the effective access is the intersection of the app's scopes and the user's own SharePoint permissions ([Overview of Selected permissions in OneDrive and SharePoint](https://learn.microsoft.com/graph/permissions-selected-overview)), and an admin role is not a permission on someone's OneDrive. Microsoft documents that adding a site collection admin where you are not one already takes an app-only identity with tenant-level permissions ([Modify SharePoint site permissions](https://learn.microsoft.com/sharepoint/dev/solution-guidance/modify-sharepoint-site-permissions-and-get-external-sharing-status#work-with-site-collection-administrators)).

The built-in automatic access delegation ([OneDrive retention and deletion](https://learn.microsoft.com/sharepoint/retention-and-deletion#configure-automatic-access-delegation)) gives access to the deleted user's **manager**, and to the secondary owner only when no manager is set. It starts when the account is deleted from Entra ID, not when it is blocked or unlicensed. The admin who runs the migration usually does not get access this way.

So a "no admin clicks" OneDrive transfer needs an app-only identity: an application permission such as `Sites.FullControl.All` with a certificate, which means a backend. SPFx package permission requests (`webApiPermissionRequests`) are delegated only.

## After the admin has been granted access

Measured on a second user's OneDrive with a test folder. The admin was removed as site collection admin afterwards and the folders were deleted.

| Step | Result |
|---|---|
| Direct link to the admin center page: `https://admin.cloud.microsoft/#/users/:/UserDetails/<objectId>/OneDrive` (object ID from the user profile property `msOnline-ObjectId`) | Opens the user's OneDrive tab with **Create link to files**. One click makes the caller site collection admin of that OneDrive |
| Delegated Graph `GET /users/{upn}/drive` | `200` with access, `403 accessDenied` without it. A good access check for the app, because Graph is not bound to the browser origin |
| Delegated Graph `GET /users/{upn}/drive/root/children` | Lists the content |
| `CreateCopyJobs` on the destination site with the other user's OneDrive file as source | File arrives as version 2.0 with history 1.0, original dates kept |
| Same with `MoveButKeepSource: false` | The source file is deleted right after the job. For "delete only after checking", copy first, check, then delete the source with Graph `DELETE /users/{upn}/drive/items/{id}` (`204`, goes to the OneDrive recycle bin) |
| Source file with an organization view link, then copied | The destination file has `HasUniqueRoleAssignments: false` – sharing links are not carried over |
| Removing yourself as site collection admin | Works only where you are admin (REST on the `-my` host: `/_api/web/getuserbyid(<id>)` with `X-HTTP-Method: MERGE` and `{ "__metadata": { "type": "SP.User" }, "IsSiteAdmin": false }`; `siteusers(<id>)` with MERGE returned 404). From a page on `<tenant>.sharepoint.com` this is cross-origin, so the app cannot do it |

## Not measured

- Whether `CreateCopyJobs` accepts an app-only caller.
- A fast way to count shared files in a large OneDrive.
