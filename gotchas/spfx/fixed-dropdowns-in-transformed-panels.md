---
title: position:fixed dropdowns go off-screen inside animated panels — the CSS transform trap
tags: [spfx, css, react, ux]
applies-to: Any web UI (bites hard in SPFx overlays)
last-reviewed: 2026-07-15
---

# `position: fixed` dropdowns go off-screen inside animated panels — the CSS transform trap

> **Bottom line.** A `transform` on any ancestor (even a settled `translateX(0)`) becomes the containing block for `position: fixed`, so a dropdown in a slide-in panel lands off-screen — render floating elements through a portal to `document.body`.
>
> **Ve zkratce.** `transform` na jakémkoli předku (i doběhlý `translateX(0)`) se stane containing blockem pro `position: fixed`, takže dropdown v zasouvacím panelu skončí mimo obrazovku – plovoucí prvky renderuj přes portál do `document.body`.

## Symptom

An autocomplete/people-picker dropdown works perfectly in a normal page — then you mount the same component inside a slide-in side panel and the dropdown **vanishes**. The search works (network tab full of results, state updates firing), but nothing visible appears. Sometimes it renders in a bizarre corner instead.

## Cause

Pure CSS, no SharePoint involved: an ancestor with **`transform`** (also `filter`, `perspective`, or certain `will-change` values) becomes the **containing block even for `position: fixed` descendants**. Slide-in panels animate with `transform: translateX(…)` — so your "fixed to the viewport" dropdown is silently fixed *to the panel* instead, and coordinates computed from `getBoundingClientRect()` (viewport-relative) put it far outside the panel's box — typically off-screen.

The cruelty: `translateX(0)` after the animation finishes still counts. The panel looks static; the containing block trap remains.

## Fix

Render the dropdown through a **portal to `document.body`** — out of the transformed subtree — and position it from the input's viewport rect:

```tsx
const rect = inputRef.current.getBoundingClientRect();
// state: { top: rect.bottom + 2, left: rect.left, width: rect.width }

{open && ReactDOM.createPortal(
  <div style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 2000 }}>
    {results.map(renderItem)}
  </div>,
  document.body
)}
```

Rule of thumb: **any floating element (dropdown, tooltip, menu) inside any animated overlay goes through a portal.** Make it the default and you'll never debug this again.

## Notes

- Select items with `onMouseDown`, not `onClick` — mousedown fires **before** the input's `onBlur`, so the dropdown doesn't close a tick before the click lands.
- Close-on-outside-click: a `document`-level `mousedown` listener (or `onBlur` with a short timeout) — remember the portal means the dropdown is *not* a DOM child of your component, so `contains()` checks must include the portal node.
- Reposition on scroll/resize if the overlay's content can scroll under the input.
- Diagnostic signature: "works on the page, invisible in the panel, console shows results" → it's this, every time.
