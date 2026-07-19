---
title: Importing third-party CSS with url(images/...) breaks the SPFx build
tags: [spfx, webpack, css, leaflet]
applies-to: SharePoint Online (SPFx)
last-reviewed: 2026-07-15
---

# Importing third-party CSS with `url(images/...)` breaks the SPFx build

> **Bottom line.** Don't `import` third-party CSS whose `url()` refs lack a `./` prefix — SPFx's css-loader reads them as module requests and the build dies; inject a `<link>` at runtime with an id-guard instead.
>
> **Ve zkratce.** Neimportuj cizí CSS, jehož `url()` odkazy nemají prefix `./` – SPFx css-loader je bere jako modulové požadavky a build spadne; místo toho injektuj `<link>` za běhu s ID-guardem.

## Symptom

You add a mapping or charting library and import its stylesheet the documented way:

```ts
import 'leaflet/dist/leaflet.css';
```

The SPFx build dies in webpack:

```
Module not found: Error: Can't resolve 'images/layers.png'
```

## Cause

SPFx pipes CSS through `@microsoft/sp-css-loader`, which can't handle relative `url()` references written **without a `./` prefix** (`url(images/layers.png)` instead of `url(./images/layers.png)`). It parses them as module requests, webpack tries to resolve them as packages, and the build fails. Leaflet is the classic offender; any library whose CSS references assets this way triggers it.

## Fix

Don't import the CSS through the bundler. Inject a `<link>` at runtime, idempotently:

```ts
function ensureLeafletCss(): void {
  if (document.getElementById('leaflet-css')) { return; }
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}
```

Call it on component mount. The `id` guard keeps multiple web part instances from stacking duplicate links.

## Notes

- For tenants that block external CDNs (strict CSP, offline), the fallback is to copy the CSS into your own styles, fix every `url(images/...)` to `url(./images/...)`, and ship the image assets yourself. It works, but it's brittle across library upgrades — prefer the `<link>` inject.
- The same inject-with-id-guard pattern is the reliable way to load **web fonts** in SPFx — SCSS `@import` of font CSS has its own set of problems.
- Pin the library version in the CDN URL (`leaflet@1.9.4`) so a silent upstream bump can't change your styling.
