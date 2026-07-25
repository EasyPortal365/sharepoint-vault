---
title: "`behavior: 'smooth'` is silently ignored inside a portaled overlay"
tags: [spfx, react, dom, scrolling, overlay]
applies-to: SharePoint Online (SPFx, React 17), Chromium-based browsers
last-reviewed: 2026-07-25
---

# `behavior: 'smooth'` is silently ignored inside a portaled overlay

> **Bottom line.** Inside a `position: fixed` overlay rendered through a React portal while `document.body` is scroll-locked, smooth scrolling never runs — not slowly, *not at all*. It affects `scrollIntoView({behavior:'smooth'})` and `scrollTo({behavior:'smooth'})` alike. Drop the option and set `scrollTop` directly.
>
> **Ve zkratce.** Uvnitř `position: fixed` overlaye vykresleného přes React portál nad zamčeným `document.body` se plynulý scroll neprovede vůbec – ani pomalu. Platí pro `scrollIntoView({behavior:'smooth'})` i `scrollTo({behavior:'smooth'})`. Vynech ten příznak a nastav `scrollTop` přímo.

## Symptom

You add a table-of-contents rail (or "jump to section" links) to a modal, document reader or lightbox. Clicking an entry **does nothing at all**. The container's `scrollTop` stays at `0`.

There is no error. The console is clean, TypeScript compiles, ESLint passes, the build succeeds. The element lookup is fine — logging the target node returns the right element with the right offset.

## Cause

The overlay is a common pattern:

```tsx
ReactDOM.createPortal(
  <div style={{ position: 'fixed', top: 48, left: 0, right: 0, bottom: 0 }}>
    <nav>…table of contents…</nav>
    <div ref={contentRef} style={{ overflowY: 'auto' }}>…long document…</div>
  </div>,
  document.body
);
```

…combined with the usual modal scroll lock:

```ts
document.body.style.overflow = 'hidden';
```

In this situation the browser **drops the smooth-scroll request**. It is not a slow animation you are failing to wait for, and it is not a wrong scroll target — the scroll simply never starts.

The trap is that the failure looks like a *lookup* bug (bad id, bad ref, element not mounted), so the natural instinct is to rewrite the element-finding logic. That changes nothing, because the culprit is the `behavior` flag.

## Proof — isolate the variables

Run this in the console against the scroll container. Change **one** thing at a time:

```js
const box = document.querySelector('#reader-content');

box.scrollTop = 0;
box.scrollTo({ top: 3000, behavior: 'smooth' });   // → 0     ✗ never moves
box.scrollTo({ top: 3000 });                       // → 3000  ✓
box.scrollTop = 3000;                              // → 3000  ✓
```

Same container, same target, same moment. Only the `behavior` flag differs — which is what makes this conclusive.

## Fix

Set the scroll position directly, computing the offset **relative to the container**:

```ts
function scrollToHeading(box: HTMLElement, el: HTMLElement): void {
  box.scrollTop = el.getBoundingClientRect().top
                - box.getBoundingClientRect().top
                + box.scrollTop;
}
```

Two details worth keeping:

- **Use `getBoundingClientRect()`, not `offsetTop`.** `offsetTop` is measured against the nearest *positioned* ancestor, so the moment somebody adds `position: relative` to a wrapper, the number silently shifts. The rect-difference form is independent of that.
- **Want the animation anyway?** Animate it yourself with `requestAnimationFrame`. Do not rely on the built-in smooth behaviour here — you have just proven it does not run.

## Why this bites in SPFx specifically

Every overlay in an SPFx web part tends to be portaled into `document.body` — that is how you escape the SharePoint page chrome and stacking contexts (see [portaled overlays miss your CSS reset](portaled-overlays-miss-your-css-reset.md)). Add the standard body scroll lock and you have reproduced the exact conditions above. So blades, readers, lightboxes and command palettes are all candidates.

## Meta-lesson: partial diagnoses produce fixes that fix nothing

The first fix here swapped `scrollIntoView` for `scrollTo` — and kept `behavior: 'smooth'`. It shipped, and the bug was completely unchanged, because the replaced API was never the problem.

When a fix that "logically must work" doesn't, **isolate the variables** (API × option × value) with an A/B test before swapping out the whole approach. Otherwise you rewrite the part that was not broken.

And note what class of bug this is: nothing in `tsc`, ESLint or the build can see it. Only clicking the thing does. A feature whose entire point is one interaction deserves that one click being verified against a live deployment.
