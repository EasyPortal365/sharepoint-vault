---
title: SPFx in Teams — the current user's numeric ID belongs to the host site, not to your data site
short-title: Teams user ID belongs to the host site
summary: "`legacyPageContext.userId` in a Teams personal app is the tenant root site's ID; written as the user's ID on another site it can silently point to someone else"
tags: [spfx, teams, rest-api, people]
applies-to: SharePoint Online (SPFx in Teams – tabs 1.8+, personal apps 1.10+)
last-reviewed: 2026-09-28
---

# SPFx in Teams: the current user's numeric ID belongs to the **host** site, not to your data site

> **Bottom line.** SharePoint numbers users separately in every site collection. In a Teams personal app your web part is hosted on the tenant root site, so `legacyPageContext.userId` is the user's ID *there*. If your app works with data on another site and stores that number as "the current user" (author, owner, assignee), it can silently point to a different person. Read the ID on the data site (`/_api/web/currentuser?$select=Id`) before you mount the app.
>
> **Ve zkratce.** SharePoint čísluje uživatele zvlášť v každé site collection. V osobní Teams appce je webpart hostovaný na kořenovém webu tenantu, takže `legacyPageContext.userId` je ID uživatele TAM. Když appka pracuje s daty na jiném webu a to číslo uloží jako „aktuálního uživatele“ (autor, vlastník, řešitel), může tím tiše označit jiného člověka. ID si přečti na datovém webu (`/_api/web/currentuser?$select=Id`) dřív, než appku připojíš.

## Symptom

Your SPFx app runs fine as a web part on its own site. You add Teams support (personal app or a channel tab on another team's site) and let the user pick the site where the data lives. Everything loads and saves without an error — but records created from Teams show a **different person** as their author or owner, and "my tasks" filters show someone else's items or nothing at all.

## Cause

A SharePoint user ID is not a tenant-wide identifier. Each site collection has its own hidden User Information List, and the same person gets a different number in each one (the entry is created when the user first visits the site collection or is added to it — `ensureUser`, a people picker, a direct permission).

Where the code runs is documented in [Deployment options for SPFx Teams solutions](https://learn.microsoft.com/sharepoint/dev/spfx/deployment-spfx-teams-solutions): a **personal app** is hosted on the tenant root site (`/_layouts/15/teamshostedapp.aspx`), a **channel tab** on the team's site. In both cases `this.context.pageContext.legacyPageContext.userId` is the user's ID on *that host site*. Your app then reads and writes lists on a *different* site collection, where the same number may not exist at all or may belong to someone else:

- a **Person/User field** can reject an ID that doesn't exist on that site — the lucky case;
- a Person field happily accepts an ID that exists there but belongs to another user;
- a **Number column** used to store a user ID (a common pattern for owner or author columns) accepts any number, so nothing ever fails.

Code that only uses the ID as a cache key (combined with the site URL) is harmless. The trap is anything that **stores** the ID as "the current user" (a custom owner, author or assignee column) and anything that **compares** stored IDs with the current user — in an OData `$filter` or on the client ("show only mine").

## Fix

Resolve the current user on the data site once, before the app mounts, and pass it down instead of the context value:

```ts
// dataSiteUrl = the site that holds the data (a stored choice, a settings list, or typed by the user)
const r = await spHttpClient.get(
  `${dataSiteUrl}/_api/web/currentuser?$select=Id`,
  SPHttpClient.configurations.v1,
  { headers: { Accept: 'application/json;odata=nometadata' } }
);
const userId = r.ok ? (await r.json()).Id as number : 0;
// don't mount the app without it — storing 0 or the host-site ID is worse than an error message
```

- Retry it like any other cross-site call from Teams: retry network errors, 5xx and 429; treat 403 and 404 as final. Treat `0` as "not verified", not as "anonymous".
- Keep one place that decides the effective user ID (SharePoint: context value; Teams: the resolved one) so no component reads `legacyPageContext.userId` directly — Microsoft documents `legacyPageContext` as a legacy object whose content can change anyway.
- The same applies to anything else taken from the host context: the web URL, the page URL for share links (`window.location` is the Teams host page), and the hub site.

## How to check your code

Search your source for `legacyPageContext.userId` (and `pageContext.legacyPageContext`) and follow every use: if the value can reach a POST/PATCH body, an OData `$filter` or a client-side comparison with stored user IDs while the app runs in Teams against another site, it needs the fix above.
