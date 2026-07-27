---
title: "Portaled overlays sit outside your CSS reset — hello, phantom scrollbar"
tags: [spfx, react, css, ux]
applies-to: SharePoint Online (SPFx web parts)
last-reviewed: 2026-07-28
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

## The sequel: extracting the overlay into a shared package

The wrapper class is easy to keep while the component lives in your app — it is right there in the JSX. It gets **silently dropped the moment you move that component into a shared UI package**, because the package has no idea your tokens are scoped to `.app-root`.

That is exactly how it bit us twice in a row. Two apps migrated their ⌘K command palette into a shared `ui` package. TypeScript, ESLint, the build and the unit tests were all green — and the palette shipped rendering in the **browser's default serif font**, because `var(--app-font-text)` resolved to nothing outside the app root. Nobody noticed for three releases; it took a screenshot from a human.

**Rule:** any shared component that portals to `body` must accept the app's scope as a prop.

```tsx
// package: accept it
export interface ICommandPaletteProps { /* … */ portalClassName?: string }
const node = <div className={portalClassName}>…</div>;
return ReactDOM.createPortal(node, document.body);

// app: pass your scope in
<CommandPalette portalClassName="app-portal" … />
```

Two extra safeguards worth the keystrokes:

- **Give tokens literal fallbacks** in the package — `var(--app-text, #002163)`. Then a forgotten class degrades to *slightly off-brand*, not *unstyled*.
- **If your apps disagree on token names, chain both.** A fleet that grew over time often has two conventions — long (`--app-font-mono`) in newer apps, short (`--app-fm`) in older ones. A shared component that reads only one renders unstyled in half of them, *even inside the app root*, where no portal is involved: `var(--app-font-mono, var(--app-fm, monospace))`. Table headers and paginators are the usual victims, because nobody screenshots them.
- **When migrating a component, ask: does it render inside the app root?** If not, the move is not a pure refactor — the CSS context changes, and nothing in your toolchain will say so.

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
