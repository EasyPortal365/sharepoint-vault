---
title: Web part properties are missing from CanvasContent1 on single-part app pages
tags: [rest-api, spfx, site-pages, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-07-25
---

# Web part properties are missing from CanvasContent1 on single-part app pages

> **Bottom line.** On a `SingleWebPartAppPage`, reading `CanvasContent1` (or `LayoutWebpartsContent`) over REST does **not** give you the web part's configured properties — both can be empty or stale. Don't conclude "the property is not set" from that; read the runtime value instead.
>
> **Ve zkratce.** U stránky typu `SingleWebPartAppPage` nedostaneš z `CanvasContent1` (ani z `LayoutWebpartsContent`) nastavené vlastnosti webové části – obojí může být prázdné nebo zastaralé. Nevyvozuj z toho, že „vlastnost není vyplněná".

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

## Related

- A control that disappears when a dependency fails is indistinguishable from a control that was never built. Gate visibility on the *feature*, and show a calm explanatory state when the dependency is missing.
- When several independent reads back one screen, give each its own error handling — a shared `Promise.all().catch()` lets one failed read silently disable unrelated features.
