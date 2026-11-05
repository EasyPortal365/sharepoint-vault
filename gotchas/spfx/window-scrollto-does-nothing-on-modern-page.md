---
title: "`window.scrollTo` does nothing in an SPFx web part on a modern page"
summary: The page scrolls inside a canvas element, not the window; switching views in a single-page web part leaves the user mid-page. Find the real scrolling ancestor and reset that
tags: [spfx, react, dom, scrolling, modern-pages]
applies-to: SharePoint Online modern pages (SPFx web parts, full-width and maximized layouts), all browsers
last-reviewed: 2026-11-05
---

# `window.scrollTo` does nothing in an SPFx web part on a modern page

> **Bottom line.** On a modern SharePoint page the window does not scroll — a canvas element inside the page does. `window.scrollTo(0, 0)` is a silent no-op, so a single-page web part that swaps views keeps the old scroll offset and the user lands in the middle of the next screen. Walk up from your web part's root to the nearest ancestor that *really* scrolls and reset its `scrollTop`.
>
> **Ve zkratce.** Na moderní stránce SharePointu neroluje okno, ale plátno uvnitř stránky. `window.scrollTo(0, 0)` tiše nic neudělá, takže webpart, který přepíná vlastní obrazovky, si drží starý posun a uživatel přistane uprostřed další obrazovky. Najdi od kořene webpartu nejbližšího předka, který opravdu roluje, a vynuluj jeho `scrollTop`.

## Symptom

Your web part is a small single-page app: a sidebar, and a main area whose content changes when the user picks another view. You scroll down a long list, click another view — and the new view appears scrolled halfway down. Short views look empty: their content is above the fold, out of sight.

You add `window.scrollTo(0, 0)` on view change. Nothing happens. `window.pageYOffset` is `0` both before and after. No error, nothing in the console.

## Cause

Modern pages keep the suite bar fixed and scroll the page body inside an element: an element with generated (hashed) class names and `data-is-scrollable="true"`, `overflow-y: scroll`. The window itself does not scroll, so `window.scrollTo` has nothing to move. Measured on a modern team-site page in November 2026: `window.scrollTo(0, 500)` left `window.pageYOffset` at `0`.

The scrolling element is not stable either:

- On a page it is SharePoint's canvas element.
- If your web part has its own "maximize" or full-screen mode with a fixed height, **your own** main area becomes the scroll container.
- Other hosts can put the scroll somewhere else again — which is why the helper below searches instead of assuming, and falls back to the window when no scrolling ancestor exists.

Hard-coding a class name breaks when SharePoint regenerates it; hard-coding `window` breaks on every modern page.

## Fix

Find the scroller at runtime: the nearest ancestor whose content overflows **and** whose computed `overflow-y` allows scrolling. Both conditions matter — a wrapper with `overflow: hidden` overflows too, but it is not the element the user scrolls, so stopping there resets the wrong box. Then scroll only when the top of your web part is actually above the visible area — a web part placed lower on the page must not yank the page up on every click.

```ts
function scrolls(el: HTMLElement): boolean {
  const ov = getComputedStyle(el).overflowY;
  return el.scrollHeight > el.clientHeight && (ov === 'auto' || ov === 'scroll');
}

export function findScrollBox(el: HTMLElement | null): HTMLElement | null {
  let p = el ? el.parentElement : null;
  while (p && p !== document.body && p !== document.documentElement) {
    if (scrolls(p)) return p;
    p = p.parentElement;
  }
  return null;
}

/** Bring the top of the app into view after a view switch. */
export function scrollAppToTop(el: HTMLElement | null, nearPageTop = 320): void {
  if (!el) return;
  if (scrolls(el)) { el.scrollTop = 0; return; }         // maximized: the app itself scrolls
  const box = findScrollBox(el);
  const elTop = el.getBoundingClientRect().top;
  if (box) {
    const boxTop = box.getBoundingClientRect().top;
    if (elTop >= boxTop) return;                          // app top already visible
    const offset = elTop - boxTop + box.scrollTop;
    box.scrollTop = offset < nearPageTop ? 0 : offset;    // near the page top: show the page header too
    return;
  }
  if (elTop >= 0) return;
  const y = elTop + (window.pageYOffset || 0);
  window.scrollTo(0, y < nearPageTop ? 0 : y);            // no scrolling ancestor: the window scrolls
}
```

Call it after the view changes, and **skip the first render** — on initial load the page should stay where SharePoint put it:

```tsx
const mainRef = React.useRef<HTMLDivElement>(null);
const first = React.useRef(true);
React.useEffect(() => {
  if (first.current) { first.current = false; return; }
  scrollAppToTop(mainRef.current);
}, [currentView]);
```

## How to verify

1. On a modern page, scroll a long view of the web part down, then switch to a short view: the view header is visible.
2. Place the web part below other content, scroll so the web part is fully visible, switch views: the page does not jump.
3. Repeat 1 in the web part's maximized mode (if it has one) and in every other host you support.

Check in DevTools which element moved: `document.querySelector('[data-is-scrollable="true"]').scrollTop` changes, `window.pageYOffset` stays `0`.

## Related

- [`behavior: 'smooth'` is silently ignored inside a portaled overlay](smooth-scroll-ignored-in-portaled-overlay.md)
