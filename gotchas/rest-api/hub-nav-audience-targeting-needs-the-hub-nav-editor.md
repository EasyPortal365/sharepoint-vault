---
title: Hub navigation audience targeting set over REST leaves the hub's targeting flag off until the hub navigation editor saves
short-title: Hub nav targeting flag needs the editor's save
summary: "`AudienceIds` on the node and `NavAudienceTargetingEnabled` on the hub web both save over REST and read back correctly, yet `HubSiteData.isNavAudienceTargeted` stays `false`; turning the switch in Edit hub navigation off and on and saving flips it – check that flag on `HubSiteData(true)`, not the web property or `MenuState`, then test with two accounts"
tags: [rest-api, navigation, hub-sites, audience-targeting, entra-groups]
applies-to: SharePoint Online hub sites (hub navigation of the hub and its associated sites)
last-reviewed: 2026-11-18
---

# Hub navigation audience targeting set over REST leaves the hub's targeting flag off until the hub navigation editor saves

> **Bottom line.** You can target a hub navigation link over REST: `AudienceIds` on `web/navigation/GetNodeById(<id>)` and `NavAudienceTargetingEnabled` on the hub web both return 204 and read back correctly. The hub's own flag `isNavAudienceTargeted` in `/_api/web/HubSiteData(true)` still says `false`, and a user outside the audience still sees the link. Measured: the flag only turned `true` after **Edit hub navigation → Enable site navigation audience targeting → Save**. Check that flag, not the web property or `navigation/MenuState`, and then confirm with two accounts.
>
> **Ve zkratce.** Cílení odkazu v navigaci hubu se přes REST uloží: `AudienceIds` uzlu i `NavAudienceTargetingEnabled` webu hubu vrátí 204 a zpětně se přečtou správně. Vlastní příznak hubu `isNavAudienceTargeted` v `/_api/web/HubSiteData(true)` ale zůstává `false` a uživatel mimo publikum odkaz dál vidí. Naměřeno: příznak přešel na `true` až po uložení v editoru **Edit hub navigation → Enable site navigation audience targeting → Save**. Ověřuj tento příznak, ne vlastnost webu ani `navigation/MenuState`, a pak živě dvěma účty.

## Symptom

A hub has a link to a private team site that only one Entra ID security group should see. A script does the obvious:

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

## Cause (as far as measured)

The hub navigation data carries its own targeting flag (`isNavAudienceTargeted`), and that flag did not follow `NavAudienceTargetingEnabled` on the web. Switching the toggle off and on in the hub navigation editor and pressing Save turned the flag to `true` on the hub and on the associated site, with the node audiences unchanged.

`HubSiteData` is cached server-side ([HubSiteData `forceRefresh`](https://learn.microsoft.com/sharepoint/dev/features/hub-site/rest-hubsitedata-method)). A `forceRefresh = false` call made by another user kept returning `false` until a `HubSiteData(true)` call refreshed it.

**Then wait.** In our case the group had been created the same day. Right after the flag turned `true`, and again early the next morning, the user outside the group still saw the link. About half an hour after that second check, the link was gone for that user from the first render of the header, while a group member still saw it. Microsoft notes that targeting for a recently created or changed group [may take some time to apply](https://learn.microsoft.com/sharepoint/homesites/use-audience-targeting-sharepoint-app-in-teams). We did not isolate whether the wait was for the flag or for the group, so treat the editor save as necessary, not as instantly effective.

`HubSiteData(true)` keeps returning the targeted node, with its `AudienceIds`, to the user outside the audience. The link is dropped when the header renders, so you can't confirm targeting from REST alone.

## Fix

1. Turn targeting on once per hub in **Edit hub navigation** (the switch, then Save). If the switch already shows On, switch it off and on so that Save becomes active. Use REST only for the node `AudienceIds`.
2. Verify with `GET /_api/web/HubSiteData(true)`: parse `value` and check `isNavAudienceTargeted === true` and the node's `AudienceIds`.
3. Then test live with two accounts, one in the group and one outside. Confirm the outside account really isn't a member (for example on its My Groups page), let the page load fully before reading the header, and with a freshly created group repeat the test later before calling it done – or broken.
   A site editor is not an exception: our test user with edit rights did not see the targeted link. Microsoft shows all links to editors only [while they edit the navigation](https://support.microsoft.com/office/target-navigation-news-and-files-to-specific-audiences-33d84cb6-14ed-4e53-a426-74c38ea32293).
4. Audience targeting only hides the link: Microsoft states it [isn't a security measure](https://learn.microsoft.com/sharepoint/homesites/use-audience-targeting-sharepoint-app-in-teams). Access to the target site is governed by its permissions.

## Notes

- `AudienceIds` takes Entra ID group object ids. Microsoft lists security groups, Microsoft 365 groups and dynamic groups as supported audiences.
- Hub navigation is [based on the top navigation bar of the hub site](https://learn.microsoft.com/sharepoint/dev/features/hub-site/hub-site-overview), so the node ids are those of the hub site's `web/navigation/TopNavigationBar`.
