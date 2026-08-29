---
title: A shared component that avoided positioning assumptions still carried a width assumption
tags: [spfx, react, layout, css, responsive]
applies-to: SPFx web parts and extensions (React), any component reused across hosts
last-reviewed: 2026-08-29
---

# A shared component that avoided positioning assumptions still carried a width assumption

> **Bottom line.** When you lift a layout out of one web part into a shared component, "it doesn't position itself" is only half the audit. A two-column layout that collapses via `@media (max-width: 820px)` measures the **viewport**, and the viewport knows nothing about the 420px panel your component was just dropped into: on a wide monitor the media query stays false and both columns keep their desktop widths inside a narrow host. Measure the **container** with `ResizeObserver` and branch on that. And when you switch, switch the *whole* layout — leaving a `maxWidth` on one child while the other goes full width produces a worse result than before.
>
> **Ve zkratce.** Když vytáhnete rozvržení z jednoho webpartu do sdílené komponenty, „neumísťuje se sama" je jen půlka kontroly. Dvousloupcové rozvržení, které se sype přes `@media (max-width: 820px)`, měří **viewport** – a ten nic neví o panelu širokém 420 px, do kterého jste komponentu právě vložili: na širokém monitoru zůstane media query nesplněná a oba sloupce si drží desktopové šířky uvnitř úzkého hostitele. Měřte **kontejner** přes `ResizeObserver` a větvete podle něj. A když přepínáte, přepněte **celé** rozvržení – nechat `maxWidth` na jednom potomkovi, zatímco druhý jde přes celou šířku, dopadne hůř než původní stav.

## Symptom

A form component renders as a comfortable two-column layout (form on the left, a tips panel on the right) everywhere it was born — full-page routes. It is then reused inside a side panel / blade roughly 420px wide, on a 2560px-wide screen. The tips panel is squeezed to two words per line and the whole thing looks broken, while DevTools insists the media query is behaving correctly.

## Cause

`@media (max-width: 820px)` is evaluated against the viewport, not the element. The viewport is 2560px, so the desktop branch wins — even though the component's own box is 420px. Any host that is narrower than the window is invisible to media queries:

- side panels, blades and flyouts
- web part zones in a multi-column SharePoint page section
- dialogs, and `ApplicationCustomizer` UI rendered into a narrow placeholder

The audit that let this through asked *"does the component position itself?"* (it didn't — no fixed/absolute, no negative margins) and stopped there. Width is a **separate** assumption from position, and it survives the move silently because nothing throws and every screenshot from the original host looks right.

## Fix

Measure the element and drive the layout from that. `ResizeObserver` fires on mount and on every container resize, including ones the window never sees:

```tsx
const rootRef = React.useRef<HTMLDivElement>(null);
const [narrow, setNarrow] = React.useState(false);

React.useEffect(() => {
  const el = rootRef.current;
  if (!el || typeof ResizeObserver === 'undefined') return undefined;   // SSR / old hosts
  const ro = new ResizeObserver(entries => {
    for (let i = 0; i < entries.length; i++) {
      setNarrow(entries[i].contentRect.width < 820);
    }
  });
  ro.observe(el);
  return () => ro.disconnect();
}, []);

return (
  <div ref={rootRef} style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 32 }}>
    <div style={narrow ? { width: '100%', minWidth: 0 } : { flex: '0 1 520px', minWidth: 0 }}>…form…</div>
    <div style={{ ...(narrow ? { width: '100%' } : { flex: '1 1 300px' }), minWidth: 0, alignSelf: 'flex-start' }}>…tips…</div>
  </div>
);
```

Both branches are stated explicitly. The first attempt at this fix only added `flex-wrap: wrap`, which let the tips panel drop to its own line — but the form kept `maxWidth: 520`, so the two blocks no longer lined up and the result looked *more* broken than the squeeze it replaced. **When the layout switches, every child switches with it.**

`minWidth: 0` on both children is not optional: flex items default to `min-width: auto`, so a long unbreakable string (a URL in the tips text) will refuse to shrink and push the layout wider than its container.

## Notes

- **Container queries** (`container-type: inline-size` + `@container`) express this natively and are the better answer where the browser floor allows it. `ResizeObserver` is the portable version and is what you want if the component ships to hosts you don't control.
- Guard the `ResizeObserver` reference. It is absent in server-side rendering and in some embedded webviews; a missing guard turns a layout nicety into a white screen.
- The reverse mistake exists too: a host that reports a **desktop** width where you'd expect mobile — see [teams-mobile-webview-renders-desktop-width.md](teams-mobile-webview-renders-desktop-width.md).
- Checklist when moving any layout into a shared component: does it assume **position** (fixed/absolute/negative margins), **width** (media queries, fixed px, `maxWidth`), **stacking** (z-index against the host's chrome), or **scrolling** (who owns the scrollbar)? Each is a separate question, and only the first one is obvious.
