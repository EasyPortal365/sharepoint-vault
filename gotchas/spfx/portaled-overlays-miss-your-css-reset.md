---
title: "Portaled overlays sit outside your CSS reset — hello, phantom scrollbar"
tags: [spfx, react, css, ux]
applies-to: SharePoint Online (SPFx web parts)
last-reviewed: 2026-07-16
---

# Portaled overlays sit outside your CSS reset — hello, phantom scrollbar

> **Bottom line.** A React portal mounts on `document.body`, outside your `.app-root`-scoped CSS reset, so it inherits `content-box` and grows a phantom scrollbar — give every portaled root its own class and reset `box-sizing` on it.
>
> **Ve zkratce.** React portál se montuje na `document.body`, mimo tvůj CSS reset navázaný na `.app-root`, takže zdědí `content-box` a naroste mu fantomový posuvník – dej každému kořeni portálu vlastní třídu a nastav mu `box-sizing`.

## Symptom

A side panel (blade/drawer/dialog) rendered with `ReactDOM.createPortal(node, document.body)` shows a **horizontal scrollbar**, and its form fields overflow the panel edge by a couple of dozen pixels — even though the widths add up perfectly on paper. The same fields inside the web part's own markup are fine.

## Cause

SPFx styles are scoped. A typical reset lives under the app root:

```scss
:global {
  .app-root *, .app-root *::before, .app-root *::after { box-sizing: border-box; }
}
```

But the portal mounts the panel on `document.body` — **outside `.app-root`** — precisely to escape SharePoint's stacking contexts. So the panel inherits the browser default, `content-box`, and every field styled the usual way overflows its parent:

```
width: 100%  +  padding: 8px 12px (24)  +  border: 1px (2)  =  parent + 26px
```

Measured live: an input rendered **605 px wide inside a 580 px parent**. The panel then grows a scrollbar.

It's sneaky for two reasons: it looks like a flex/grid layout bug rather than a missing reset, and teams usually patch it inline (`style={{ boxSizing: 'border-box' }}`) on the fields that hurt — so the root cause survives and bites the next panel.

## Fix

Give every portaled root its own class and reset it explicitly:

```tsx
// Blade.tsx
const node = (
  <div className="app-blade-root" style={themeVars}>
    <aside style={{ position: 'fixed', top: 48, right: 0, bottom: 0, width }}>…</aside>
  </div>
);
return ReactDOM.createPortal(node, document.body);
```

```scss
:global {
  .app-blade-root, .app-blade-root *,
  .app-blade-root *::before, .app-blade-root *::after { box-sizing: border-box; }
}
```

One rule fixes every field in every panel, present and future.

## Notes

- **Diagnose, don't guess.** Run this in the console with the panel open — it names the offenders:
  ```js
  const blade = document.querySelector('.app-blade-root');
  Array.from(blade.querySelectorAll('input, textarea, select'))
    .filter(el => el.getBoundingClientRect().width > el.parentElement.getBoundingClientRect().width + 0.5)
    .map(el => ({ tag: el.tagName, w: el.getBoundingClientRect().width,
                  parent: el.parentElement.getBoundingClientRect().width,
                  boxSizing: getComputedStyle(el).boxSizing }));
  ```
- The same blind spot applies to **anything else your reset assumes**: CSS custom properties (design tokens), font stacks, base `color`. If tokens live on `.app-root` rather than `:root`, portaled panels lose theming too — pass them onto the portal wrapper explicitly.
- Applies to every portaled surface: drawers, dialogs, command palettes, toasts.
