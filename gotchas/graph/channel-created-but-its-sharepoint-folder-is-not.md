---
title: Creating a Teams channel returns 201 long before its SharePoint folder exists
tags: [graph, microsoft-teams, sharepoint, provisioning, channels, async]
applies-to: Microsoft Graph v1.0 (/teams/{id}/channels), SharePoint Online document libraries
last-reviewed: 2026-09-13
---

# A Teams channel exists immediately — its folder does not

> **Bottom line.** `POST /teams/{team-id}/channels` returns **201** and the channel shows up in Teams and in `List channels` right away, but the matching folder in the team site's default document library is provisioned **asynchronously by Teams**. Measured on a live tenant: the folder did not exist **two minutes** after creation, nor after ten. Anything that writes into that folder straight after creating the channel — subfolders, files, permissions — fails on a missing parent. Do not "fix" this by creating the folder yourself: a hand-made folder of the same name has **no channel behind it**, looks identical, and nobody notices.

## Symptom

```http
POST https://graph.microsoft.com/v1.0/teams/{team-id}/channels
{ "displayName": "Site protocols", "membershipType": "standard" }

HTTP/1.1 201 Created
```

The channel is usable in Teams. Meanwhile:

```http
GET {site}/_api/web/GetFolderByServerRelativeUrl('/sites/x/Shared Documents/Site protocols')?$select=Exists

HTTP/1.1 200 OK
{ "Exists": false }
```

Note the **200 with `Exists: false`** — the status code alone tells you nothing here, you have to read the value in the body.

## Why

The channel (Teams service) and its folder (SharePoint) are two separate provisioning steps. Teams creates the folder lazily — commonly not until the channel's *Files* tab is opened for the first time. No API promises a deadline and nothing signals completion.

## What to do

1. **Never create the folder yourself.** It is the most tempting fix and the worst one: the folder looks right, the channel is not attached to it, and every later check ("does the structure match?") passes while the site is quietly wrong.
2. **Poll briefly, then move on.** A handful of attempts (≈20 s) covers the fast path. Waiting longer blocks the whole operation and still may not succeed.
3. **Report the pending state as a sentence, not as an error.** "Channel created; its folder has not appeared yet — subfolders will be added by the next run" is true and actionable. Silent success and a red failure are both lies.
4. **Skip work that depends on the folder in this pass** and let an idempotent reconciliation finish it later. That is what idempotency is for.

## Permissions note

Creating a channel accepts `Channel.Create` and — flagged by Microsoft as *backward compatibility only* — `Directory.ReadWrite.All` or `Group.ReadWrite.All`. Listing channels accepts `Channel.ReadBasic.All` and, on the same backward-compatibility footing, `Directory.Read.All`, `Group.Read.All`, `Group.ReadWrite.All`. Building on the legacy ones works today but can stop working without notice, so declare the least-privileged scope in your app manifest even if everything runs.

⚠ In SPFx you cannot verify the fallback on your own tenant: delegated grants belong to the tenant-wide *SharePoint Online Client Extensibility Web Application Principal*, so if any component ever had `Channel.*` approved, your call succeeds regardless of what your package requests.

## Related

- [`GetStorageEntity` returns 200 for a missing key](../rest-api/getstorageentity-returns-200-for-missing-key.md) — same shape as the `?$select=Exists` trap used above: a 200 that means "no".
