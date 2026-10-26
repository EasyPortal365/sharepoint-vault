---
title: A CDN-hosted extension bundle may only import modules its App Catalog manifest declares
short-title: Extension bundle imports a module the manifest lacks
summary: "Replacing an extension's stable-named bundle on the CDN without a new .sppkg works only while its `define([...])` lists modules already in the installed manifest's `scriptResources` — one new value import and the extension silently never starts"
tags: [spfx, extensions, cdn, command-set, app-catalog]
applies-to: SharePoint Framework (Application Customizer, ListView Command Set) with includeClientSideAssets false
last-reviewed: 2026-10-26
---

# The bundle changed, the manifest didn't

> **Bottom line.** When you ship an SPFx extension once and then only swap its stable-named bundle on your CDN, the manifest SharePoint uses is still the one from the `.sppkg` you installed back then. Its `loaderConfig.scriptResources` decides which external modules (`@microsoft/sp-http`, `react`…) the loader can resolve. Add a value import of a module that list doesn't have and the bundle's `define([...])` asks for it anyway — RequireJS fails, the component is never created, and the command or customizer just isn't there.
>
> **Ve zkratce.** Když po instalaci měníte jen soubor rozšíření na CDN, platí pořád manifest ze starého balíčku. Zavaděč umí jen externí moduly, které ten manifest zná. Nový hodnotový import (třeba `@microsoft/sp-http`) rozšíření tiše shodí – položka v menu prostě není.

## Symptom

- A ListView Command Set's button no longer appears anywhere. Other extensions on the same page are fine.
- The extension's script is downloaded (you see it in the network log), but nothing it would normally do happens: selecting a row triggers no requests.
- The console shows the cause **once at most**, and only sometimes:

  ```
  Error: Script error for "@microsoft/sp-http", needed by: <componentId>_1.0.0
  ```

  Later page loads are silent, which makes it easy to chase the wrong thing (selection events, caching).

Build, unit tests and deployment all pass — the mismatch only exists between your new bundle and a manifest that lives in the customer's App Catalog.

## Cause

An SPFx bundle is an AMD module:

```js
define("<componentId>_1.0.0",
  ["@microsoft/sp-listview-extensibility", "@microsoft/sp-loader", "@microsoft/sp-http"],
  (e, t, n) => { /* … */ });
```

SharePoint resolves each dependency through the component manifest's `loaderConfig.scriptResources`. That manifest comes from the `.sppkg` and is not updated when you replace the bundle on your CDN. If version 1 never imported `@microsoft/sp-http`, its manifest has no entry for it — and a later bundle that does `import { SPHttpClient } from '@microsoft/sp-http'` (for example to use `SPHttpClient.configurations.v1`) can no longer be loaded.

## Diagnose

Compare the two lists in the browser, on a page where the extension should run:

```js
// 1. what the installed manifest declares
function find(o, id) { if (!o || typeof o !== 'object') return null;
  if (o.id === id && o.loaderConfig) return o;
  for (const k in o) { const r = find(o[k], id); if (r) return r; } return null; }
const m = find(window.g_spfxData, '<componentId>');
Object.keys(m.loaderConfig.scriptResources);

// 2. what the bundle asks for
const t = await fetch('<your CDN bundle URL>', { cache: 'reload' }).then(r => r.text());
t.match(/define\("[^"]+",(\[[^\]]*\])/)[1];
```

Anything in (2) that is missing from (1) is the culprit. To prove it before releasing a fix, put a copy of the live bundle with that entry removed from `define([...])` into the page's Cache Storage for the bundle URL (the Lists app serves extension bundles from `Lists-odsp-web-prod_*` caches), reload, and watch the extension start.

## Fix

- In the extension bundle, import from modules the installed manifest does **not** list as **types only** (`import type { SPHttpClient } from '@microsoft/sp-http'`).
- Take statics from an instance the context already gives you instead of the module:

  ```ts
  function v1(client: SPHttpClient): SPHttpClientConfiguration {
    return (client.constructor as unknown as
      { configurations: { v1: SPHttpClientConfiguration } }).configurations.v1;
  }
  const r = await context.spHttpClient.get(url, v1(context.spHttpClient));
  ```

- Guard it: a unit test that walks the extension entry file and its relative imports, collects value imports of `@microsoft/*` / `react*`, and fails on anything outside the manifest's list. After a build, `head -c 300` of the bundle shows the `define([...])` line too.
- If the new module is genuinely needed, that is a manifest change: ship a new `.sppkg` and get it installed — the CDN alone cannot deliver it.
