---
title: "/_api/hubsites is trimmed per user — a lookup that walks the hubs finds your app for the page editor and not for the reader"
short-title: /_api/hubsites is trimmed per user
summary: "`GET /_api/hubsites` returned 2 hubs to an admin and 1 to an ordinary user who had Full Control on the missing hub's site, so client code that discovers something by walking the hub list works for the editor and silently fails for readers; resolve it at authoring time and store the result in the web part properties"
tags: [rest-api, hub-sites, spfx, discovery, permissions, caching]
applies-to: SharePoint Online REST (`/_api/hubsites`), SPFx web parts that locate a resource through hub sites
last-reviewed: 2026-11-03
---

# /_api/hubsites is trimmed per user — a lookup that walks the hubs finds your app for the page editor and not for the reader

> **Bottom line.** `GET /_api/hubsites` does not return the same list to everyone. In our tenant it returned 2 hubs to an administrator and 1 to an ordinary user — and the missing hub was a site where that user had **Full Control** and could read the list we were looking for. So the list is not trimmed by site permissions. If your web part discovers something (a list, an app instance, a configuration site) by walking that list, the page editor sees it work and readers get "not found". Resolve the lookup while the page is being edited and save the result in the web part properties; treat the hub walk as a convenience for the editor, never as what readers depend on.
>
> **Ve zkratce.** `GET /_api/hubsites` nevrací všem stejný seznam. U nás vrátil správci 2 huby a běžnému uživateli 1 – a chybějící hub byl web, kde měl ten uživatel **Full Control** a hledaný seznam četl. Seznam se tedy neořezává podle práv k webu. Když webpart něco hledá (seznam, instanci appky, konfigurační web) procházením tohoto seznamu, redaktorovi to funguje a čtenáři dostanou „nenalezeno“. Vyřeš hledání při úpravě stránky a výsledek ulož do vlastností webpartu; procházení hubů ber jako pohodlí pro redaktora, ne jako to, na čem stojí čtenáři.

## Symptom

A web part placed on a site outside any hub looks for a companion app by reading an app registry list on each hub site (`/_api/hubsites` → for each hub, `GetList(...)/items`). As the administrator who built the page, it finds the app and works. An ordinary user opening the same page gets the "not set up here" path. If the web part caches its lookup result, that user keeps the wrong answer for the cache lifetime.

## What we measured

| Call | Administrator | Ordinary user |
|---|---|---|
| `GET /_api/hubsites?$select=SiteUrl` | 200, **2** hubs | 200, **1** hub |
| Effective permissions of the user on the missing hub's site (`getusereffectivepermissions`) | – | Full Control |
| Reading the registry list on the missing hub as that user | – | 200 |

So the user *can* read what we need on that hub; the hub just is not in *their* `/_api/hubsites` answer.

**Hypothesis, not verified:** the list follows hub-site permissions (who may associate sites with the hub, as set by `Grant-SPOHubSiteRights`), not site permissions. We did not test changing those rights.

## Fix

1. **Resolve at authoring time.** When the page is in edit mode and the hub walk finds the target, write it into the web part properties (`this.properties.xyzUrl = found`). The value is saved with the page and readers no longer depend on what *they* can enumerate.
2. **Explicit property wins.** If the property is set, use it and do not walk the hubs at all.
3. **Short negative cache.** Cache "found" for as long as you like, but cache "not found" or "forbidden" for minutes, not an hour — a fixed configuration must not stay broken for readers.
4. **Diagnose under the reader's account.** "Works for me, not for my colleague" is answered by the colleague's own status codes (a read-only console snippet printing each step's HTTP status and the cached result), not by what the admin account sees.

## Notes

- Seen while testing a request form web part that finds its app through hub registries (2026-11-03). The wrong answer showed up as a misleading "version too old" message, because the loader fell back to a default version when nothing was found — make "not found" visible before anything that depends on finding it.
