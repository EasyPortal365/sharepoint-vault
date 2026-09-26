---
title: "Printing from a web part gives a blank page when the print CSS hides `body > *` and the print layer lives inside the web part"
short-title: "Print layer must be a direct child of `<body>`"
summary: "A common way to print a report from an SPFx web part is to hide everything in print (`body > * { display: none }`, so the SharePoint suite bar, navigation and footer stay out) and show only a dedicated print layer. If that layer is rendered inside the web part, it is a descendant of a hidden element and the printout is blank. Render the print layer with a React portal straight into `document.body`"
tags: [spfx, react, print, css, ux]
applies-to: SPFx web parts (React) that print their own reports through `window.print()` and a print-only layer on a modern SharePoint page
last-reviewed: 2026-09-26
---

# Printing from a web part gives a blank page when the print CSS hides `body > *` and the print layer lives inside the web part

> **Bottom line.** Hiding the whole SharePoint page in print with `body > * { display: none !important }` and showing only your print layer works only if the print layer is itself a direct child of `<body>`. Rendered anywhere inside the web part, it sits under a hidden ancestor and the printout is empty. Render it with `ReactDOM.createPortal(…, document.body)` and route every print through that one component.
>
> **Ve zkratce.** Skrýt v tisku celou stránku SharePointu přes `body > * { display: none !important }` a ukázat jen tiskovou vrstvu funguje jen tehdy, když je ta vrstva sama přímým potomkem `<body>`. Vykreslená kdekoli uvnitř webpartu leží pod skrytým předkem a tisk vyjde prázdný. Vykresli ji přes `ReactDOM.createPortal(…, document.body)` a veď každý tisk přes tuhle jedinou komponentu.

## Symptom

The web part has a "Print / Save as PDF" button. The report renders fine on screen (or is prepared off screen), the browser's print dialog opens, and the preview is a blank page. Nothing fails in the console. A second variant: a button that calls `window.print()` directly prints an empty page too, because the same stylesheet hides the whole page and nothing is marked as the print layer.

## Cause

The print stylesheet usually looks like this:

```css
.app-print { display: none; }
@media print {
  body > * { display: none !important; }   /* suite bar, navigation, footer, the page itself */
  .app-print { display: block !important; }
}
```

On a SharePoint page, the web part is deep inside the page's own root element, which is one of the `body > *` elements hidden in print. An element whose ancestor has `display: none` is never rendered, whatever its own `display` says. So a print layer rendered next to the report component, inside the web part, disappears together with the page.

Neither the screen nor a unit test without the print media type shows the problem: on screen the layer is hidden on purpose.

## Fix

Render the print layer as a direct child of `<body>` and make it the only way the web part prints:

```tsx
import * as ReactDOM from 'react-dom';

export const PrintLayer: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  ReactDOM.createPortal(<div className="app-print">{children}</div>, document.body);

export function usePrint(): { printing: boolean; print: () => void } {
  const [printing, setPrinting] = React.useState(false);
  const print = React.useCallback(() => {
    setPrinting(true);                       // render the layer first…
    window.setTimeout(() => {                // …then open the print dialog
      try { window.print(); } finally { setPrinting(false); }
    }, 60);
  }, []);
  return { printing, print };
}
```

The specificity works out: `.app-print` (0,1,0) beats `body > *` (0,0,1) when both are `!important`.

## Notes

- Keep a small test that renders the layer inside a nested component and asserts it ends up in `document.body.children`, plus a source scan that fails when the print class or `window.print(` appears anywhere else. It is the only check that catches a regression, because nobody looks at print previews during development.
- CSS custom properties (theme tokens) set on the web part's root do not reach a portal in `<body>`. Put them on `<html>` or on a class you also give the portal.
