---
title: SharePoint's SPA router hijacks anchor clicks — onClick never fires
short-title: SPA router hijacks anchor clicks
summary: "`<a href>` navigates before React `onClick` runs; use buttons for in-app actions"
tags: [spfx, react, modern-pages, ux]
applies-to: SharePoint Online (modern pages)
last-reviewed: 2026-10-08
---

# SharePoint's SPA router hijacks `<a href>` clicks — your `onClick` never fires

> **Bottom line.** Modern SharePoint's SPA router grabs `<a href>` clicks in the capture phase before your React `onClick` ever runs, so use a `<button>` or a `role="link"` element for in-app actions and keep anchors for real navigation.
>
> **Ve zkratce.** SPA router moderního SharePointu zachytí kliknutí na `<a href>` v capture fázi dřív, než se vůbec spustí tvůj React `onClick` – pro akce uvnitř aplikace použij `<button>` nebo prvek s `role="link"` a `<a href>` nech jen pro skutečnou navigaci.

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

### The row-action variant: a button *inside* a link

The trap resurfaces when the anchor is legitimate navigation but you need a small action on top of it — the classic "list row links to the detail page, plus an edit pencil on the right":

```tsx
// Broken: the router navigates before onEdit ever runs — and a <button>
// inside an <a> is invalid HTML in the first place.
<a href={item.url}>
  …row…
  <button onClick={onEdit}>✎</button>
</a>
```

Make the action a **sibling** of the anchor and position it over the row:

```tsx
<div style={{ position: 'relative' }}>
  <a href={item.url}>…row…</a>
  <button
    type="button"
    onClick={onEdit}
    style={{ position: 'absolute', right: 0, top: 12 }}
  >✎</button>
</div>
```

The click now lands on the button, never on the anchor, so there is nothing for the router to hijack — and the markup is valid.

### The injected-HTML variant: links inside content you render as HTML

Content that is generated **outside** your web part — a documentation package, a knowledge-base export, Markdown converted to HTML — often cross-links its own pages with **relative** links (`<a href="chapter-06-site-lifecycle.html">`). Rendered through `dangerouslySetInnerHTML` on a modern page, such a link resolves against the *page* URL (`/sites/x/SitePages/chapter-06-….html`) and ends in a 404. You can't fix it with a click handler either — it's an internal `<a href>`, so the router takes it first.

Rewrite the HTML **before** rendering instead of trying to catch the click:

```ts
// relative link to a page the package really has → button with the target id
html = html.replace(/<a\s+[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (whole, href, text) => {
  const id = targetIdFromHref(href);           // e.g. "chapter-06-….html" → "CH-06"; null for external links
  if (!id) return whole;                       // external link: leave it as published
  if (!knownIds.has(id)) return `<span>${text}</span>`; // dead target: plain text beats a 404
  return `<button type="button" data-target="${id}">${text}</button>`;
});
```

```tsx
// one delegated listener on the container (the HTML isn't React, so per-button handlers aren't possible)
<div onClick={e => {
  const btn = (e.target as HTMLElement).closest('[data-target]');
  if (btn) openInApp(btn.getAttribute('data-target')!);
}} dangerouslySetInnerHTML={{ __html: html }} />
```

Only put a value into the attribute that you matched with a strict pattern (letters, digits, dashes), never the raw `href`. Do the same for any **export** of that content (print view, downloaded HTML): there the relative link leads nowhere, so keep just its text. And measure the whole package before you trust a sample — generators tend to repeat a pattern in every page (in one real case every section also started with an `<h2>` that duplicated the heading the reader already rendered).

## Notes

- Diagnostic signature: on a published page the click "just navigates", `preventDefault` has no effect, but the same handler on a `<button>` works → it's this.
- Keep accessibility in mind when replacing anchors: `role="link"` (or a real `<button>`), `tabIndex={0}` and Enter/Space handling, as shown above.
