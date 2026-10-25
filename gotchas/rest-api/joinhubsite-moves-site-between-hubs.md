---
title: JoinHubSite silently moves a site that already belongs to another hub
short-title: JoinHubSite moves sites between hubs
summary: Calling `JoinHubSite` on a site that sits in hub A returns 200 and the site is in hub B at once — no unjoin step, no warning, so any "apply hub" plan must read the current hub first
tags: [rest-api, hub-sites, governance]
applies-to: SharePoint Online
last-reviewed: 2026-10-25
---

# JoinHubSite silently moves a site that already belongs to another hub

> **Bottom line.** `POST /_api/site/JoinHubSite('<hub B>')` on a site that is already associated with hub A succeeds with 200, and `HubSiteId` reads hub B immediately. There is no "leave first" step and no error. If your tool applies a hub from a policy, read the current hub first and tell the person the site will **move** — otherwise you rewire navigation and theme of someone else's hub without them knowing.
>
> **Ve zkratce.** `JoinHubSite('<hub B>')` u webu, který už patří do hubu A, vrátí 200 a web je hned v hubu B – bez odpojení a bez varování. Nástroj, který hub nastavuje podle pravidel, musí nejdřív přečíst současný hub a říct, že se web **přesune**.

## Symptom

A governance tool "reconciles" older sites with their policy: the policy says hub B, so the tool calls `JoinHubSite`. Some of those sites were deliberately placed in hub A by their owners. After the run they show hub B's navigation and theme. Nothing in the call result hinted at a move.

## Measured

```http
GET  /sites/demo/_api/site?$select=HubSiteId          → hub A
POST /sites/demo/_api/site/JoinHubSite('<hub B id>')  → 200
GET  /sites/demo/_api/site?$select=HubSiteId          → hub B
```

Measured as a site collection admin of the site, with `odata=nometadata` headers (the docs list 204 for success; we got 200 – treat any 2xx as success). If the hub restricts **who can associate sites** with it, the caller must be on that list.

## Fix

Read the current association before you plan anything:

```js
const r = await fetch(`${siteUrl}/_api/site?$select=HubSiteId`, { headers: { Accept: 'application/json;odata=nometadata' } });
if (!r.ok) throw new Error(`Current hub unknown (HTTP ${r.status})`); // never treat "unknown" as "no hub"
const { HubSiteId } = await r.json();
const current = HubSiteId === '00000000-0000-0000-0000-000000000000' ? '' : HubSiteId;
// current === target → nothing to do
// current === ''     → "joins hub B"
// otherwise          → "moves from hub A to hub B" – show it before writing
```

Use `JoinHubSite('00000000-0000-0000-0000-000000000000')` to leave a hub ([JoinHubSite](https://learn.microsoft.com/sharepoint/dev/features/hub-site/rest-joinhubsite-method)).

## Related

- [HubSites returns an empty list, not 403](hubsites-returns-empty-list-not-403.md)
