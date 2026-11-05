---
title: A shared stylesheet injected once per page keeps the first web part's version — your CSS fix may never apply
short-title: Shared style tag – the first web part wins
summary: "A library that injects `<style id=…>` only if the id is missing lets whichever bundle renders first decide the CSS for every web part on the page, so a fixed rule in a newer bundle silently loses to an older copy"
tags: [spfx, css, web-parts, shared-library]
applies-to: SharePoint Framework (any version), several web parts or extensions on one page
last-reviewed: 2026-11-05
---

# A shared stylesheet injected once per page keeps the first web part's version

> **Bottom line.** When a shared UI library injects its CSS as `<style id="x">` and skips the injection if that id already exists, the first bundle to render decides the stylesheet for the whole page. Web parts from different SPFx solutions ship their own copies of the npm library, so after you fix a rule, a page that also hosts an older build still runs the old rule. Do not rely on the fixed shared rule in the component that suffered from the bug — give it its own styling.
>
> **Ve zkratce.** Sdílená knihovna, která vkládá `<style id="x">` jen tehdy, když id na stránce ještě není, nechá o CSS celé stránky rozhodnout první vykreslený bundle. Každý SPFx webpart si knihovnu nese ve vlastní kopii – oprava pravidla se na stránce se starším buildem neprojeví. Komponenta, kterou vada bolela, se na opravené sdílené pravidlo nesmí spoléhat; dejte jí vlastní vzhled.

## Symptom

You fix a CSS rule in your shared UI package, rebuild one web part, deploy it — and on some pages the bug is still there. In the browser the `<style>` element has the right id, but its text is the old rule. On a page where the fixed web part is alone, everything looks right.

## Cause

The usual pattern for CSS that has to reach portals (panels and dialogs rendered into `document.body`, where SCSS modules scoped to the web part do not apply) looks like this:

```ts
const ID = 'my-lib-css';
export function injectCss(): void {
  if (document.getElementById(ID)) return;   // already on the page – skip
  const s = document.createElement('style');
  s.id = ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}
```

The guard is right for one bundle: it stops duplicates when the component mounts many times. It does not know about versions. Web parts and extensions from different SPFx solutions each bundle their own copy of the npm package, built at different times, so two web parts on one page can carry two different `CSS` strings under the same id. Whichever calls `injectCss()` first wins, and the order depends on render timing, not on which build is newer.

## How it surfaced

A shared "card with a checkbox" class had the rule `.card input { width: 16px; height: 16px }`. A bare `input` selector also hit text fields, and its specificity (class + element) beat the field rule `.field { width: 100% }`. Another screen reused the card class as a frame around a row of text inputs, and every input shrank to a few pixels. The shared rule was then fixed to `.card input[type=checkbox], .card input[type=radio]` — but a page that also ran an older bundle would inject the old rule first and bring the bug back.

## Fix

1. **Fix the shared rule anyway**, and narrow selectors on form controls by type (`input[type=checkbox]`), never with a bare `input` or `select`.
2. **Make the affected component independent of the rule.** It should not borrow a class that has its own meaning ("card with a checkbox") just for the border and background. Give it its own styling: inline style, or a class name the old stylesheet does not have.
3. **Optionally version the id** (`my-lib-css-v2`) when a change must win on a mixed page. Old and new styles then both stay on the page, so do it only when the new rule is additive or more specific.
4. **Test the selector, not the screenshot:** inject the stylesheet in jsdom and check with `element.matches(rule.selectorText)` that no rule gives a text input a fixed width below a sane minimum. Also check in the other direction that the checkbox still gets its size.

## Related

- [Third-party CSS breaks webpack](css-url-assets-break-webpack.md) – injecting a `<link>` instead of importing CSS
