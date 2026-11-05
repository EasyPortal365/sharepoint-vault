---
title: A shared stylesheet injected once per page keeps the version that rendered first — your CSS fix may not apply next to an older build
short-title: Shared style tag – the first web part wins
summary: "A library that injects `<style id=…>` only if the id is missing lets whichever bundle renders first decide the CSS for every web part on the page, so a fixed rule in a newer bundle can silently lose to an older copy that rendered first"
tags: [spfx, css, web-parts, shared-library]
applies-to: SharePoint Framework, several web parts or extensions from different solutions on one page
last-reviewed: 2026-11-05
---

# A shared stylesheet injected once per page keeps the version that rendered first

> **Bottom line.** When a shared UI library injects its CSS as `<style id="x">` and skips the injection if that id already exists, the first bundle to render decides the stylesheet for the whole page. By default, web parts from different SPFx solutions ship their own copies of the npm library, so after you fix a rule, a page that also hosts an older build can still run the old rule – whenever the older build renders first. Do not rely on the fixed shared rule in the component that suffered from the bug – give it its own styling.
>
> **Ve zkratce.** Sdílená knihovna, která vkládá `<style id="x">` jen tehdy, když id na stránce ještě není, nechá o CSS celé stránky rozhodnout první vykreslený bundle. Webparty z různých SPFx řešení si knihovnu ve výchozím stavu nesou každý ve vlastní kopii – na stránce se starším buildem se oprava pravidla nemusí projevit (když se starší build vykreslí dřív). Komponenta, kterou vada bolela, se na opravené sdílené pravidlo nesmí spoléhat; dejte jí vlastní vzhled.

## Symptom

You fix a CSS rule in your shared UI package, rebuild one web part and deploy it. On a page where the fixed web part is alone, everything looks right. On pages that also host an older build of another solution, the bug can still be there: the `<style>` element has the right id, but its text is the old rule.

## Cause

A common pattern for CSS that has to reach portals – panels and dialogs rendered into `document.body`, outside the web part's root element, where SCSS rules nested under the web part's root class do not reach – looks like this (a plain TypeScript library also has no SCSS pipeline of its own):

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

The guard is right for one bundle: it stops duplicates when the component mounts many times. It does not know about versions. By default, SPFx bundles npm dependencies into each component's bundle, so web parts and extensions from different solutions each carry their own copy of the package (unless it is configured as an external or shipped as an SPFx library component), built at different times. Two web parts on one page can therefore carry two different `CSS` strings under the same id. Whichever calls `injectCss()` first wins, and the order depends on render timing, not on which build is newer.

## How it surfaced

A shared "card with a checkbox" class had the rule `.card input { width: 16px; height: 16px }`. A bare `input` selector also hit text fields, and its specificity (one class + one element, 0,1,1) beat the field rule `.field { width: 100% }` (0,1,0). Another screen reused the card class as a frame around a row of text inputs, and every text input shrank to about 27 × 16 px. The shared rule was then fixed to `.card input[type=checkbox], .card input[type=radio]` – but on a page that also ran an older bundle, that bundle could inject the old rule first and bring the bug back.

## Fix

1. **Fix the shared rule anyway**, and narrow selectors on form controls by type (`input[type=checkbox]`). Avoid a bare `input` or `select` inside a shared class that may wrap other content.
2. **Make the affected component independent of the rule.** It should not borrow a class that has its own meaning ("card with a checkbox") just for the border and background. Give it its own styling: inline style, or a class name the old stylesheet does not have.
3. **Optionally version the id** (`my-lib-css-v2`) when a change must win on a mixed page. Old and new styles then both stay on the page, so do it only when the new rule is additive or more specific. It does not help when the fix narrows or removes a selector, as in the case above, because the old rule still ships in the old stylesheet; and a change at equal specificity again depends on which `<style>` is inserted last.
4. **Test the selector, not the screenshot:** inject the stylesheet in jsdom and check with `element.matches(rule.selectorText)` that no rule gives a text input a fixed width or height below a sane minimum (walk rules nested in `@media` too). Also check in the other direction that the checkbox still gets its size.

## Related

- [Third-party CSS breaks webpack](css-url-assets-break-webpack.md) – injecting a `<link>` with an id guard instead of importing CSS; the same "first one wins" applies when two solutions pin different versions under the same id
