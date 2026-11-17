---
title: Hub navigation audience targeting set over REST is stored but not applied until the hub navigation editor saves it
short-title: Hub nav targeting needs the editor's save
summary: "`AudienceIds` on the node and `NavAudienceTargetingEnabled` on the hub web both save over REST and read back correctly, yet `HubSiteData.isNavAudienceTargeted` stays `false` and everyone still sees the link; turning the switch in Edit hub navigation off and on and saving flips it – verify on `HubSiteData(true)`, not on the web property or `MenuState`"
tags: [rest-api, navigation, hub-sites, audience-targeting, entra-groups]
applies-to: SharePoint Online hub sites (hub navigation of the hub and its associated sites)
last-reviewed: 2026-11-17
---

# Hub navigation audience targeting set over REST is stored but not applied until the hub navigation editor saves it

> **Bottom line.** You can target a hub navigation link over REST: `AudienceIds` on `web/navigation/GetNodeById(<id>)` and `NavAudienceTargetingEnabled` on the hub web both return 204 and read back correctly. The hub navigation still ignores them, and everyone keeps seeing the link, until **Edit hub navigation → Enable site navigation audience targeting → Save** has run once. The value that tells you it's applied is `isNavAudienceTargeted` in `/_api/web/HubSiteData(true)`, not the web property and not `navigation/MenuState`.
>
> **Ve zkratce.** Cílení odkazu v navigaci hubu se přes REST uloží: `AudienceIds` uzlu i `NavAudienceTargetingEnabled` webu hubu vrátí 204 a zpětně se přečtou správně. Navigace hubu je ale ignoruje a odkaz dál vidí všichni, dokud se jednou neuloží editor **Edit hub navigation → Enable site navigation audience targeting → Save**. Že cílení platí, poznáš podle `isNavAudienceTargeted` v `/_api/web/HubSiteData(true)`, ne podle vlastnosti webu ani podle `navigation/MenuState`.

## Symptom

A hub has a link to a private team site that only one group should see. A script does the obvious:

```http
POST /sites/hub/_api/web                              (X-HTTP-Method: MERGE)
{ "NavAudienceTargetingEnabled": true }               → 204

POST /sites/hub/_api/web/navigation/GetNodeById(2104) (X-HTTP-Method: MERGE)
{ "AudienceIds": ["<Entra group object id>"] }        → 204
```

Reading back looks right. `web?$select=NavAudienceTargetingEnabled` is `true`, the node has the group in `AudienceIds`, and `HubSiteData(true)` lists the node with that audience. Still, `HubSiteData` has `"isNavAudienceTargeted": false` on the hub and on the associated site. A user outside the group sees the link in the server-rendered header.

Two more things mislead:

- `/_api/navigation/MenuState?mapprovidername='GlobalNavigationSwitchableProvider'` returns the node with `AudienceIds: []`, even to a site admin. You can't use it to check targeting.
- After the REST calls, the Edit hub navigation panel already shows the switch **On** and the audience icon on the link. **Save** is disabled because nothing looks changed.

## Cause

The hub navigation takes its "targeting on" flag from the hub's own data (`isNavAudienceTargeted`). That flag is not derived from `NavAudienceTargetingEnabled` on the web. The flag is written when the hub navigation editor saves. Measured: switching the toggle off and on in the editor and pressing Save turned `isNavAudienceTargeted` to `true` on the hub and on the associated site. The node audiences were unchanged.

`HubSiteData` is cached server-side. A call with `forceRefresh = false` made by another user kept returning `false` until a `HubSiteData(true)` call refreshed it.

## Fix

1. Turn targeting on once per hub in **Edit hub navigation** (the switch, then Save). If the switch already shows On, switch it off and on so that Save becomes active. Use REST only for the node `AudienceIds`.
2. Verify with `GET /_api/web/HubSiteData(true)`: parse `value` and check `isNavAudienceTargeted === true` and the node's `AudienceIds`.
3. Then test live with two accounts, one in the group and one outside. Microsoft notes that a newly created or changed group can take time to apply in targeting. A link may stay visible to non-members for a while after the flag is `true`, so don't call it done after the first try.
4. Audience targeting only hides the link. Access to the target site is governed by its permissions alone.

## Notes

- `AudienceIds` takes Entra ID group object ids (security groups, Microsoft 365 groups). SharePoint groups are not supported for targeting.
- The node id is the `Id` from `web/navigation/TopNavigationBar` of the hub site. Hub navigation is the hub's top navigation bar.
