---
title: Web part properties are missing from CanvasContent1 on single-part app pages
short-title: App page properties are not in CanvasContent1
summary: Single-part app pages store web part config elsewhere; do not diagnose "not set" from page fields — but the web part id IS there, so use it to find the hosting page (not ClientSideApplicationId)
tags: [rest-api, spfx, site-pages, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-10-05
---

# Web part properties are missing from CanvasContent1 on single-part app pages

> **Bottom line.** On a `SingleWebPartAppPage`, reading `CanvasContent1` (or `LayoutWebpartsContent`) over REST does **not** give you the web part's configured properties — both can be empty or stale. Don't conclude "the property is not set" from that; read the runtime value instead.
>
> **Ve zkratce.** U stránky typu `SingleWebPartAppPage` nedostaneš z `CanvasContent1` (ani z `LayoutWebpartsContent`) nastavené vlastnosti webové části – obojí může být prázdné nebo zastaralé. Nevyvozuj z toho, že „vlastnost není vyplněná“.

## Symptom

You are debugging why a web part behaves as if a property were empty (a hub URL, an API endpoint, a feature flag). You check the stored page over REST:

```http
GET /_api/web/GetFileByServerRelativeUrl('/sites/team/SitePages/App.aspx')/ListItemAllFields
    ?$select=CanvasContent1,LayoutWebpartsContent,PageLayoutType
```

The response says `PageLayoutType: "SingleWebPartAppPage"`, `LayoutWebpartsContent` is an empty string, and `CanvasContent1` either has no `"hubSiteUrl":"…"`-style entry at all or carries an old, empty one.

You conclude the property was never filled in — but opening the page's property pane shows the value sitting right there, and the web part uses it at runtime.

## Cause

`CanvasContent1` describes the **canvas** of a normal modern page (sections, columns, web part instances with their serialized properties). A single-part app page has no canvas the author edits: the page hosts exactly one web part, and its configuration is persisted by a different mechanism. Whatever remains in `CanvasContent1` is a leftover from how the page was created and is not the source of truth.

The same trap applies to any diagnosis based on scraping page fields: `CanvasContent1` reflects **one** way of storing web part state, not all of them.

## Fix

Verify the value the way the code actually sees it.

**1. Property pane (authoritative, no code).** Edit the page, open the web part's properties, and read the field. This is the fastest check and it is what the author configured.

**2. Runtime value from the React tree** (when you need to prove what the component received, e.g. from a browser console during live debugging):

```js
// Walk up the fiber from any rendered node until a props object carries the value.
function findProps(node) {
  const key = Object.keys(node).filter(k => k.indexOf('__reactFiber$') === 0)[0];
  if (!key) return null;
  let f = node[key], hops = 0;
  while (f && hops++ < 200) {
    const p = f.memoizedProps || f.pendingProps;
    if (p && p.webProps) return p.webProps;   // whatever prop bag you pass down
    f = f.return;
  }
  return null;
}
findProps(document.querySelector('[class*="my-app-root"]'));
```

**3. Make the app say it itself.** The durable fix is not a better probe — it is that the app should never hide a feature without explanation. If a capability depends on a property being set, render a short line stating which property is missing, instead of silently omitting the control. A missing switch reads as "this product cannot do it"; a one-line note reads as "fill this in and it will work".

## What the leftover *does* contain: the web part id

The properties are unreliable, but the **web part's component id is there**. Measured on a real `SingleWebPartAppPage`: `CanvasContent1` was about 1.5 kB, `LayoutWebpartsContent` was empty, and the id from the web part's `manifest.json` was inside the canvas leftover (HTML-escaped JSON in `data-sp-webpartdata`).

That makes `CanvasContent1` the right signal for a different question — **"which page on this site hosts web part X?"** — for example when one app needs a deep link into a sibling app installed on the same site and there is no registry to ask:

```js
// Page(s) on a site that host a given SPFx web part (article pages and single-part app pages alike).
const WP_ID = '00000000-0000-0000-0000-000000000000';   // "id" from the web part's manifest.json
const site = 'https://contoso.sharepoint.com/sites/team';
const r = await fetch(site + "/_api/web/GetList('/sites/team/SitePages')/items?$select=FileRef,CanvasContent1&$top=100",
  { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include' });
const pages = (await r.json()).value
  .filter(p => String(p.CanvasContent1 || '').toLowerCase().indexOf(WP_ID) !== -1)
  .map(p => p.FileRef);
```

Follow `odata.nextLink` on large page libraries — `$top` is a page size, not a cap.

**Do not use `ClientSideApplicationId` for this.** It looks like the obvious field ("application id"), but a single-part app page carries the **generic Site Pages id** (`b6917cb1-93a0-4b97-a84d-7cf49975d4ec`) there — the same value as any article page. It tells you nothing about which web part runs on the page.

> **Ve zkratce (doplněk).** Vlastnosti webové části v `CanvasContent1` aplikační stránky spolehlivé nejsou, **id webové části ale ano** – podle něj najdeš stránku, na které běží. `ClientSideApplicationId` k tomu nepoužívej: i aplikační stránka v něm má obecné id knihovny stránek.

## Related

- A control that disappears when a dependency fails is indistinguishable from a control that was never built. Gate visibility on the *feature*, and show a calm explanatory state when the dependency is missing.
- When several independent reads back one screen, give each its own error handling — a shared `Promise.all().catch()` lets one failed read silently disable unrelated features.
