---
title: SharePoint's SPA router hijacks anchor clicks — onClick never fires
tags: [spfx, react, modern-pages, ux]
applies-to: SharePoint Online (modern pages)
last-reviewed: 2026-07-15
---

# SharePoint's SPA router hijacks `<a href>` clicks — your `onClick` never fires

## Symptom

A clickable card in an SPFx web part is built the classic way:

```tsx
<a href={item.url} onClick={(e) => { e.preventDefault(); openModal(item); }}>…</a>
```

On a **published** modern page, clicking it navigates straight to the URL. The modal never opens, `preventDefault()` never runs — as if the handler didn't exist. Meanwhile an ordinary `<button onClick>` elsewhere in the same web part works fine.

## Cause

Modern SharePoint runs its own client-side (SPA) router. It listens for clicks on internal `<a href>` links **in the capture phase** and performs its own navigation *before* the event ever reaches React's `onClick` (bubble phase). Your handler is simply too late.

Two things make this extra confusing:

- The router only cares about `<a href>` with internal URLs — `<button>` and `<div>` are ignored, so *some* of your click handlers work.
- In **page edit mode** the editor handles clicks differently, so the bug may not reproduce there. Always test on a published page.

## Fix

Don't use `<a href>` for in-app actions. Use a non-anchor element:

```tsx
// clickable card
<div
  role="link"
  tabIndex={0}
  onClick={() => openModal(item)}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(item); } }}
  style={{ cursor: 'pointer' }}
>…</div>

// or simply a button
<button type="button" onClick={() => openModal(item)}>Read more</button>
```

Reserve `<a href>` for real navigation — links that genuinely take the user away from the page (those you *want* the router or browser to handle).

## Notes

- Diagnostic signature: on a published page the click "just navigates", `preventDefault` has no effect, but the same handler on a `<button>` works → it's this.
- Keep accessibility in mind when replacing anchors: `role="link"` (or a real `<button>`), `tabIndex={0}` and Enter/Space handling, as shown above.
