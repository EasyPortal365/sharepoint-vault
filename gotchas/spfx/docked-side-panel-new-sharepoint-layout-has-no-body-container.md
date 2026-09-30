---
title: "A docked side panel floats in mid-air on the newer SharePoint layout: `.sp-App-bodyContainer` is not there"
short-title: "Docking a side panel on the newer SharePoint layout"
summary: "A Copilot-style side panel narrows the SharePoint page by shrinking `.sp-App-bodyContainer`. On the newer page chrome (left app bar with Discover/Publish/Build) that container does not exist, so the docking code silently falls back to a floating panel with gaps around it. Dock against `#spPageChromeAppDiv` instead, and shrink it with `margin-right` – it is a flex item, so `width` has no effect."
tags: [spfx, application-customizer, layout, css, ux]
applies-to: SPFx web parts and application customizers that open a fixed side panel and want to narrow the modern SharePoint page beside it
last-reviewed: 2026-09-30
---

# A docked side panel floats in mid-air on the newer SharePoint layout: `.sp-App-bodyContainer` is not there

> **Bottom line.** Don't rely on a single page container for docking. Look for `.sp-App-bodyContainer` first (narrow it with `width: calc(100% - <panel>px)`); if it is missing, use `#spPageChromeAppDiv` and narrow it with `margin-right: <panel>px`. That element is a flex item of the page chrome row, so a `width` you set is simply overridden. Start the docked panel right under the suite bar (`top: 48px`) and let it run to the bottom.
>
> **Ve zkratce.** Nespoléhej při připnutí panelu na jediný kontejner stránky. Nejdřív hledej `.sp-App-bodyContainer` (zúžit přes `width: calc(100% - <panel>px)`); když chybí, vezmi `#spPageChromeAppDiv` a zuž ho přes `margin-right: <panel>px`. Ten prvek je flex položka řádku stránky, takže nastavená `width` se neprojeví. Připnutý panel začni hned pod horní lištou (`top: 48px`) a nech ho dojet až dolů.

## Symptom

Your side panel is supposed to dock to the right edge and push the page content left, the way Copilot does. On some sites it works. On others the panel just floats near the right edge with a gap on the right and at the bottom, the page underneath is not narrowed, and the panel looks detached ("hanging in mid-air"). No error in the console.

## Cause

The docking code looks for the page container `.sp-App-bodyContainer` and, when it can't find it, falls back to floating – quietly, because floating was meant as the safe option for unknown layouts.

The newer SharePoint page chrome (`<div id="SPPageChrome" class="SPPageChrome isFluent">` with the left app bar `#sp-appBar` – Discover, Publish, Build, OneDrive) has no `.sp-App-bodyContainer` at all. The content to the right of the app bar is `#spPageChromeAppDiv`, and it is a **flex item** in a `display: flex; flex-direction: row` parent:

- setting `style.width` on it changes nothing – the flex layout keeps its width;
- setting `style.marginRight` does shrink it, and the page reflows correctly.

A second trap if another component hosts your panel: if the panel code finds "its" container by walking up to the nearest `position: fixed` ancestor and restyles it (width, right, bottom), it will also overwrite the host's own docking styles.

## Fix

```ts
const PANEL_W = 480;
const legacy = document.querySelector('.sp-App-bodyContainer') as HTMLElement | null;
const modern = !legacy ? document.getElementById('spPageChromeAppDiv') : null;

if (legacy) {
  legacy.style.width = `calc(100% - ${PANEL_W}px)`;          // older layout
} else if (modern && side === 'right') {
  modern.style.marginRight = `${PANEL_W}px`;                  // newer layout: flex item
}
// panel: position fixed; top 48px (right under the suite bar); bottom 0; right 0; width PANEL_W
// on close: reset width / margin-right to ''
```

- Dock only on the right with the newer layout – the left side belongs to the app bar.
- Keep a minimum viewport width (for example 1100 px) below which you float instead; the page would be unusable.
- Always restore the page when the panel closes, whatever the reason.

## How to verify

Open the page on a wide window in both layouts and measure, don't guess:

```js
document.querySelector('.sp-App-bodyContainer');          // null on the newer layout
document.getElementById('spPageChromeAppDiv').getBoundingClientRect().width; // shrinks by the panel width when docked
```

A panel that floats on a wide window is a bug, not a graceful fallback – check it with a screenshot on both layouts.
