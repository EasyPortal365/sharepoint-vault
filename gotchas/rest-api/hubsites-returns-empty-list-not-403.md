---
title: /_api/HubSites returns an empty list (HTTP 200) when the caller cannot see the hub sites
tags: [rest-api, hub-sites, permissions, governance, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-29
---

# `/_api/HubSites` returns an empty list (HTTP 200) when the caller cannot see the hub sites

> **Bottom line.** `GET /_api/HubSites` is security-trimmed: it lists only hubs whose hub site the caller may read. Missing permission shows up as `value: []` with **HTTP 200**, not as 403 — so "the tenant has no hubs" and "this account sees no hubs" are indistinguishable from the response alone. Never derive *"this site has no hub"* or *"nothing is inherited from a hub"* from an empty list.
>
> **Ve zkratce.** `GET /_api/HubSites` je ořezaný podle oprávnění: vrátí jen huby, na jejichž web volající vidí. Chybějící právo se projeví jako `value: []` se stavem **200**, ne jako 403 – z odpovědi samotné tedy nerozlišíš „tenant huby nemá" od „tenhle účet na ně nevidí". Z prázdného seznamu nikdy nevyvozuj, že web žádný hub nemá.

## Symptom

A governance view tells you a site is **not connected to any hub** and therefore *"inherits no owner/steward from a hub"*. The same view, opened by a different account on the same tenant, draws the full hub tree correctly.

Measured on the very site the view was describing:

```http
GET /_api/site?$select=HubSiteId,IsHubSite
→ 200  { "HubSiteId": "63c5ce9c-…", "IsHubSite": true }

GET /_api/HubSites
→ 200  { "value": [] }
```

The site *is* a hub, and it *does* carry a `HubSiteId` — yet the hub list is empty, with a success status.

## Cause

`/_api/HubSites` enumerates hub sites the caller is allowed to see; entries whose hub site is not readable for that account are filtered out. Trimming produces an **empty set, not an error**, so code written as

```js
const hubs = await getHubs();               // 200 → []
const hub  = hubs.find(h => h.ID === site.HubSiteId);   // undefined
if (!hub) { /* "the site has no hub" */ }   // ← wrong conclusion
```

silently turns "we could not see it" into a factual claim. In a governance report that claim then propagates: the site is rendered as a plain site instead of a hub, the inheritance chain comes out empty, and a field that should read *unknown* reads *missing* — a number people act on.

## Fix

**1. Ask the object itself whether it is a hub.** `IsHubSite` and `HubSiteId` come from `_api/site` of the site you are already reading, so they survive wherever the rest of the detail survives:

```http
GET /_api/site?$select=HubSiteId,IsHubSite
```

**2. Treat "belongs to a hub, but that hub is not in the list" as a contradiction, not a fact.**

```js
const hubs = await getHubs();                 // may be [] or null
const known = !!hubs && (!site.hubSiteId
  || hubs.filter(h => normGuid(h.ID) === site.hubSiteId).length > 0);

if (!known) {
  // The inheritance chain is UNKNOWN. Report "not determined" plus the reason —
  // never "nothing is inherited".
}
```

**3. Say why in the UI.** "The hub this site belongs to could not be read, so we claim nothing about inherited ownership" is a different message from "this site has no hub", and only one of them is true here.

## Why it matters

The failure is invisible to types, linters and tests: the call succeeds, the array is a valid array, and the wrong branch is ordinary code. It only surfaces when someone with different permissions opens the same screen — or when a person named in the report objects.

## Applies more widely

Any tenant-wide collection read **as the user** can come back trimmed to nothing with HTTP 200 — hub sites, search results over sites, followed sites, tenant properties. When your logic needs "the set is complete" (counting, inheritance, "nobody is responsible"), cross-check against the object the statement is about, or degrade to *unknown*. See also: `deleted-site-vs-site-you-cannot-see.md` (404 ≠ 403) and `dont-cache-a-throttled-permission-probe.md`.
