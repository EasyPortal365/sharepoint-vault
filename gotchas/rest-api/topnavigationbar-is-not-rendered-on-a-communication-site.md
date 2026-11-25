---
title: "Links posted to `topnavigationbar` never appear on a communication site — the horizontal menu renders QuickLaunch"
short-title: Horizontal menu renders QuickLaunch
summary: "On a site with `HorizontalQuickLaunch = true` — every modern communication site — the menu under the site title comes from `web/navigation/quicklaunch`. Writes to `web/navigation/topnavigationbar` return 201 and read back fine, they are simply never rendered"
tags: [rest-api, navigation, provisioning, csom, multilingual]
applies-to: SharePoint Online (modern communication sites), delegated REST and CSOM calls
last-reviewed: 2026-11-25
---

# Links posted to `topnavigationbar` never appear on a communication site — the horizontal menu renders QuickLaunch

> **Bottom line.** A modern communication site keeps `HorizontalQuickLaunch = true` and draws the horizontal menu under the site title from **QuickLaunch**, not from the top link bar. `POST web/navigation/topnavigationbar` still returns 201 and `GET` still returns what you wrote, so every check short of looking at the page says the navigation is done. Post to `web/navigation/quicklaunch` instead, and read `HorizontalQuickLaunch` before you decide which collection to write to.
>
> **Ve zkratce.** Moderní komunikační web má `HorizontalQuickLaunch = true` a vodorovné menu pod názvem webu kreslí z **QuickLaunch**, ne z horního panelu odkazů. `POST web/navigation/topnavigationbar` přesto vrátí 201 a `GET` vrátí, co jsi zapsal – takže každá kontrola kromě pohledu na stránku tvrdí, že je navigace hotová. Zapisuj do `web/navigation/quicklaunch` a předem si přečti `HorizontalQuickLaunch`, ať víš, která kolekce je ta správná.

## Symptom

A provisioning script fills the top navigation of a freshly created communication site:

```http
POST /sites/projects/_api/web/navigation/topnavigationbar
Content-Type: application/json;odata=verbose
X-RequestDigest: <digest>

{"__metadata":{"type":"SP.NavigationNode"},"Title":"Shared","Url":"/sites/projects/shared/Forms/AllItems.aspx","IsExternal":false}
```

Every link returns `201 Created`. Reading the collection back returns all of them, in order, with the ids the writes produced. The page keeps showing the three default links (`Home`, `Pages`, `Site contents`) and nothing else. No error anywhere.

## Cause

A web has two separate node collections, and which one is rendered depends on the site, not on the name:

| Collection | Classic team site | Modern communication site |
|---|---|---|
| `web/navigation/topnavigationbar` | top link bar | **not rendered** (still writable) |
| `web/navigation/quicklaunch` | left-hand menu | the horizontal menu under the site title |

The switch is `HorizontalQuickLaunch`. Communication sites (`WebTemplate` `SITEPAGEPUBLISHING`, configuration `0`) have it set to `true` out of the box, and then QuickLaunch is what the header draws. TopNavigationBar keeps accepting writes — it is a real collection with real nodes — so nothing fails. It is just dead storage on that site.

## Fix

Ask the web which menu it draws before writing:

```http
GET /sites/projects/_api/web?$select=WebTemplate,Configuration,HorizontalQuickLaunch,MegaMenuEnabled
```

`HorizontalQuickLaunch: true` → write to `quicklaunch`:

```http
POST /sites/projects/_api/web/navigation/quicklaunch
Content-Type: application/json;odata=verbose
X-RequestDigest: <digest>

{"__metadata":{"type":"SP.NavigationNode"},"Title":"Shared","Url":"/sites/projects/shared/Forms/AllItems.aspx","IsExternal":false}
```

Two things that bite right after:

- **Order.** A new node is appended to the end; the REST API takes no position. To put your links above an existing one, delete that node and re-create it afterwards — `POST web/navigation/getnodebyid(<id>)` with `X-HTTP-Method: DELETE` and `IF-MATCH: *`.
- **Translations.** SharePoint localizes its own default nodes, so `Home` reads back as `Domovská stránka` under `Accept-Language: cs-CZ` without anyone setting it. A node you create yourself does not get that for free — it shows the same text in every language until you set the resource for each culture through `TitleResource.SetValueForUICulture` in a `ProcessQuery` call, exactly as for a list title.

Verify by reading the collection **and** by loading the page. The read alone cannot tell you which collection the header uses.

## Notes

- Clean up what you wrote into the wrong collection. Leftover nodes in `topnavigationbar` are invisible on this site but will surface if the site is ever switched or its content is copied to a template.
- Hub navigation is a third store again, maintained by the hub site and merged in above the site's own menu — see [Hub nav audience targeting needs the hub nav editor](hub-nav-audience-targeting-needs-the-hub-nav-editor.md).
- The same `$select` tells you whether the site uses the mega menu (`MegaMenuEnabled`), which changes how sub-links are displayed but not which collection is read.
