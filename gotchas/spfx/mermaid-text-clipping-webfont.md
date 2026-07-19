---
title: Mermaid clips node text when you set a web font (measure-before-load)
tags: [spfx, mermaid, fonts, rendering]
applies-to: SharePoint Online (SPFx, React 17); any web app rendering Mermaid client-side
last-reviewed: 2026-07-19
---

# Mermaid clips node text when you set a web font (measure-before-load)

## Symptom

You render Mermaid diagrams client-side and style them with a brand **web font** (via `themeVariables.fontFamily` and/or the top-level `fontFamily`). Node boxes come out **too narrow** — the last few characters of a label are cut off at the box border (e.g. `Return request to employ` instead of `…employee`). It looks fine with Mermaid's default font.

## Cause

Mermaid **measures text width at render time** to size each node box, then draws the label. If the web font you asked for is **not yet loaded** when `mermaid.render()` runs, the browser measures with a fallback font (narrower), Mermaid sizes the box for that width — and once the web font finishes loading (FOUT), the actual text reflows **wider** than the box that was already committed. The box was cut for the wrong font.

This bites SPFx especially: brand fonts are usually injected via a runtime `<link>` in the page `<head>`, so the first diagram often renders before the font is ready.

## Fix

Use a **system font** for Mermaid — both the top-level `fontFamily` and `themeVariables.fontFamily`. It is always available, so measurement and rendering agree:

```js
const FONT = "'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',            // sanitizes untrusted diagram source (Mermaid runs it through DOMPurify)
  theme: 'base',
  fontFamily: FONT,
  themeVariables: { fontFamily: FONT /* + your brand colours: primaryColor, lineColor, … */ },
  flowchart: { htmlLabels: true, padding: 10 }
});
```

Keep your **brand colours** via `themeVariables` (`primaryColor` / `primaryBorderColor` / `lineColor` / …) — only the *font* needs to be a safe system stack; the palette can stay on-brand.

If you truly must use a web font, gate the first render behind `document.fonts.ready` (and re-render on font load) so measurement happens after the font is available. The system-font route is simpler and sidesteps the race entirely.

## Related

- **Lazy-load** Mermaid as its own chunk — `await import(/* webpackChunkName: "mermaid" */ 'mermaid')` — it is large and pulls in d3/dagre, so you don't want it in the main bundle.
- Render only a **complete** fenced ```` ```mermaid ```` block. A half-streamed block (no closing fence yet) is invalid syntax and will flash the error/fallback state on every streaming delta; treat "closing fence not seen" as "still a code block".
- `securityLevel: 'strict'` matters when the diagram source is **untrusted** (e.g. produced by an LLM) — it disables interactive/script features and sanitizes the output SVG.
