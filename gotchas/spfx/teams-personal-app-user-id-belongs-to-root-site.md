---
title: SPFx in Teams — the current user's numeric ID belongs to the host site, not to your data site
short-title: Teams user ID belongs to the host site
summary: "`legacyPageContext.userId` in a Teams personal app is the tenant root site's ID; written to a person field on another site it silently names someone else"
tags: [spfx, teams, rest-api, people]
applies-to: SharePoint Online (SPFx 1.18+, Teams)
last-reviewed: 2026-09-28
---

# SPFx in Teams: the current user's numeric ID belongs to the **host** site, not to your data site

> **Bottom line.** SharePoint numbers users separately in every site collection. In a Teams personal app your web part is hosted on the tenant root site, so `legacyPageContext.userId` is the user's ID *there*. If your app works with data on another site and writes that number into a person field (author, owner, assignee), it silently points to a different person. Read the ID on the data site (`/_api/web/currentuser?$select=Id`) before you mount the app.
>
> **Ve zkratce.** SharePoint čísluje uživatele zvlášť v každé site collection. V osobní Teams appce je webpart hostovaný na kořenovém webu tenantu, takže `legacyPageContext.userId` je ID uživatele TAM. Když appka pracuje s daty na jiném webu a to číslo zapíše do pole osoby (autor, vlastník, řešitel), tiše tím označí jiného člověka. ID si přečti na datovém webu (`/_api/web/currentuser?$select=Id`) dřív, než appku připojíš.

## Symptom

Your SPFx app runs fine as a web part on its own site. You add Teams support (personal app or a channel tab on another team's site) and let the user pick the site where the data lives. Everything loads and saves without an error — but records created from Teams show a **different person** as their author or owner, and "my tasks" filters show someone else's items or nothing at all.

## Cause

A SharePoint user ID is not a tenant-wide identifier. Each site collection has its own hidden User Information List, and the same person gets a different number in each one (the ID is assigned when the user is first seen on that site collection).

In a Teams **personal app**, SPFx hosts your component on the tenant root site (`/_layouts/15/teamshostedapp.aspx`); in a **channel tab** it runs on the team's site. In both cases `this.context.pageContext.legacyPageContext.userId` is the user's ID on *that host site*. Your app then reads and writes lists on a *different* site collection — where the same number either doesn't exist (the write fails with a lookup error, which is the lucky case) or belongs to someone else (the write succeeds and is wrong).

Code that only uses the ID as a cache key (combined with the site URL) is harmless. The trap is any **write** into a Person/User field (`AuthorId`, `OwnerId`, `AssignedToId`, …) and any **filter** that compares a person field with the current user's ID.

## Fix

Resolve the current user on the data site once, before the app mounts, and pass it down instead of the context value:

```ts
// data site chosen by the Teams host (stored choice, hub registry, or typed by the user)
const r = await spHttpClient.get(
  `${dataSiteUrl}/_api/web/currentuser?$select=Id`,
  SPHttpClient.configurations.v1,
  { headers: { Accept: 'application/json;odata=nometadata' } }
);
const userId = r.ok ? (await r.json()).Id as number : 0;
// don't mount the app without it — writing 0 or the host-site ID is worse than an error message
```

- Retry this read like any other cross-site call from Teams (the first request from a cold mobile client sometimes fails) and treat `0` as "not verified", not as "anonymous".
- Keep one place that decides the effective user ID (SharePoint: context value; Teams: the resolved one) so no component reads `legacyPageContext.userId` directly.
- The same applies to anything else taken from the host context: the web URL, the page URL for share links (`window.location` is the Teams host page), and the hub site.

## How to check your code

Search your source for `legacyPageContext.userId` (and `pageContext.legacyPageContext`) and follow every use: if the value can reach a POST/PATCH body or an OData `$filter` while the app runs in Teams against another site, it needs the fix above.
