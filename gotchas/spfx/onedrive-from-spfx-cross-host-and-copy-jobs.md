---
title: Moving OneDrive files into SharePoint from an SPFx app – start the copy job on the destination site
short-title: OneDrive to SharePoint from SPFx
summary: "An SPFx page on `<tenant>.sharepoint.com` cannot call `<tenant>-my.sharepoint.com` (CORS) and cannot get a SharePoint token, but `CreateCopyJobs` called on the DESTINATION site accepts a OneDrive source and keeps version history and dates; an admin still has no access to someone else's OneDrive"
tags: [spfx, onedrive, copy-move-api, cors, migration]
applies-to: SharePoint Online, OneDrive for Business, SharePoint Framework
last-reviewed: 2026-11-27
---

# OneDrive → SharePoint from an SPFx app

> **Bottom line.** Your SPFx code runs on `<tenant>.sharepoint.com` and the browser will not let it call `<tenant>-my.sharepoint.com` at all. You do not need to: the Copy/Move API (`/_api/site/CreateCopyJobs`) works when you call it on the **destination** site with an absolute OneDrive URL as the source. The copy keeps the version history and the original Created/Modified. What stays out of reach is access: a global admin cannot read another person's OneDrive until they are made its site collection admin.
>
> **Ve zkratce.** Appka na `<tenant>.sharepoint.com` na OneDrive (`-my`) přímo nedosáhne, ale kopii lze spustit na cílovém webu se zdrojem v OneDrivu – přenese verze i časy. Do cizího OneDrivu ale správce bez přidělení přístupu nevidí.

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
- **Do not plan on REST calls to `-my` for listing files.** Neither cookies nor an SPFx-issued SharePoint token get there. Listing a OneDrive has to go another way, such as Microsoft Graph over the user's drive. That route was not measured here.
- **Admin access to another person's OneDrive is a separate step.** The copy runs with the caller's permissions, so the admin must first be added as site collection admin of that OneDrive. In the Microsoft 365 admin center this is "Access files" on the user. The SharePoint admin API lives on the `-admin` host, which is another origin, so the app cannot grant this access from the browser. It can only point the admin to the setting and check the result by reading.

## Not measured

- A copy from someone else's OneDrive after access was granted. Only the caller's own OneDrive was tested.
- Whether Microsoft Graph listing of another user's drive works with delegated permissions once access is granted.
