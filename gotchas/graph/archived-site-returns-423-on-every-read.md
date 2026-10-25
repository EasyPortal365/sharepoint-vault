---
title: An archived site returns 423 on every Graph read — keep the site collection ID to reactivate it
short-title: Archived site returns 423 on every read
summary: "`archivalDetails` is unreadable once archived; `POST /sites/{host},{siteCollectionId}/unarchive` still works"
tags: [graph, microsoft-365-archive, sharepoint, site-lifecycle, beta]
applies-to: "Microsoft Graph beta site archive / unarchive, v1.0 siteCollection.archivalDetails, delegated Sites.Archive.All + SharePoint Administrator"
last-reviewed: 2026-10-25
---

# An archived site returns 423 on every Graph read

> **Bottom line.** After `POST /beta/sites/{id}/archive` succeeds, every Graph read of that site fails with `423 notAllowed` / `resourceLocked` ("Access to this site has been blocked"): by path, by site ID, and site search returns nothing. So you can't read `siteCollection.archivalDetails` for an archived site, and code that looks up the site ID right before calling `unarchive` breaks. `POST /beta/sites/{hostname},{siteCollectionId}/unarchive` still returns `202` — store the site collection GUID **before** archiving and reactivate by it.
>
> **Ve zkratce.** Po úspěšném `POST /beta/sites/{id}/archive` skončí každé čtení webu z Graphu chybou `423 notAllowed` / `resourceLocked`: podle cesty, podle id a hledání webu nevrátí nic. Stav `siteCollection.archivalDetails` archivovaného webu tak nepřečtete a kód, který si id zjišťuje těsně před `unarchive`, selže. `POST /beta/sites/{hostname},{siteCollectionId}/unarchive` ale vrátí `202` – GUID kolekce si uložte **před** archivací a reaktivujte podle něj.

## Symptom

A lifecycle tool archives a site, then offers "Reactivate". Both steps first read the live state:

```http
GET https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/project-x?$select=id,siteCollection
```

Before archiving this returns the composite ID (`contoso.sharepoint.com,{siteCollectionId},{webId}`) and no `archivalDetails` (= active). Right after a successful archive the same call returns:

```json
{ "error": { "code": "notAllowed",
  "message": "Access to this site has been blocked. Please contact the administrator to resolve this problem.",
  "innerError": { "code": "resourceLocked" } } }
```

with HTTP `423`. Reactivation never starts because the ID lookup fails.

## Cause

Measured with a delegated token (SharePoint Administrator, `Sites.Archive.All` granted) a few seconds and again a minute after archiving:

| Request | Result |
|---|---|
| `GET /v1.0/sites/{host}:/sites/project-x` | `423` |
| `GET /v1.0/sites/{host},{siteCollectionId}` | `423` |
| `GET /v1.0/sites?search=project-x` | `200`, empty `value` |
| `POST /beta/sites/{host},{siteCollectionId}/unarchive` | `202`, site reachable again within seconds |

An archived site is locked for reads, and `archivalDetails` is only visible while you can read the site. In practice you can't tell `recentlyArchived` from `fullyArchived` through Graph. `resourceLocked` is the generic "site is locked" signal; a site locked with `Set-SPOSite -LockState NoAccess` is blocked as well (not measured here), so don't treat a 423 alone as proof that the site is archived.

## Fix

1. **Before archiving**, read the site once and persist the site collection GUID, the second part of the composite ID. It equals SharePoint's `Site.Id`:

   ```ts
   const r = await client.api(`/sites/${host}:${path}?$select=id,siteCollection`).get();
   const siteCollectionId = r.id.split(',')[1];   // save to your registry
   await client.api(`/sites/${r.id}/archive`).version('beta').post({});
   ```

2. **When a read returns 423** and you have the GUID, treat the site as "archived or locked, phase unknown" instead of failing. Don't flip your own records to "archived" on that basis – a site locked with NoAccess is blocked too.

3. **Reactivate by the stored GUID:**

   ```ts
   await client.api(`/sites/${host},${siteCollectionId}/unarchive`).version('beta').post({});
   // 202 Accepted; within 7 days of archiving the site is back almost immediately, later up to 24 h
   ```

4. Map `423` to its own message ("already archived, or locked with NoAccess"). Don't fold it into a generic "archive not enabled" hint.

## See also

- [site: unarchive (beta)](https://learn.microsoft.com/graph/api/site-unarchive?view=graph-rest-beta)
- [siteArchivalDetails resource type](https://learn.microsoft.com/graph/api/resources/sitearchivaldetails?view=graph-rest-1.0)
- [Archive states in Microsoft 365 Archive](https://learn.microsoft.com/microsoft-365/archive/archive-states)
