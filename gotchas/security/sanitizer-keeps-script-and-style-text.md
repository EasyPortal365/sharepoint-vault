---
title: An allowlist sanitizer that keeps the text of disallowed tags dumps CSS and JavaScript source into your content
tags: [security, sanitization, xss, spfx, rich-text]
applies-to: SPFx web parts, any DOMParser-based HTML allowlist
last-reviewed: 2026-08-29
---

# An allowlist sanitizer that keeps the text of disallowed tags dumps CSS and JavaScript source into your content

> **Bottom line.** The usual allowlist rule — *drop the disallowed tag, keep the text inside* — is right for `<font>` or `<table>`, where the text is what the reader wanted. Applied to `<script>` and `<style>` it preserves their **source code as visible text**: paste a copied web page into your editor and a wall of CSS lands in the article. It is not an XSS hole — nothing executes — which is exactly why security tests pass and the bug ships. An allowlist needs **two** sets, not one: tags to keep, and tags to drop *with their subtree*.
>
> **Ve zkratce.** Obvyklé pravidlo allowlistu – *zahoď nepovolený tag, zachovej text uvnitř* – je správné u `<font>` nebo `<table>`, kde text je to, co čtenář chtěl. U `<script>` a `<style>` ale zachová **jejich zdrojový kód jako viditelný text**: vložení zkopírované webové stránky vysype do článku zeď CSS. Není to XSS díra – nic se nespustí – a právě proto bezpečnostní testy projdou a vada se vydá. Allowlist potřebuje **dvě** množiny, ne jednu: co zachovat a co zahodit **i s podstromem**.

## Symptom

A rich-text editor sanitizes on save with a DOMParser allowlist. A user pastes content copied from a web page, and the saved article contains lines like:

```
.hdr{margin:0;padding:0}.nav a{color:#06c}  window.dataLayer=window.dataLayer||[]
```

No script ran. No tag survived. The page is not compromised — it is just full of garbage that nobody typed.

## Cause

The sanitizer has a single fallback branch for anything not on the allowlist:

```ts
if (ALLOWED[tag]) {
  // rebuild the element, recurse
} else {
  // disallowed wrapper → drop the tag, keep the text inside
  clean(el, out);                     // or: replaceChild(createTextNode(el.textContent), el)
}
```

That branch is correct for presentational wrappers: `<font color=red>hello</font>` should become `hello`. But `<script>`, `<style>`, `<template>`, `<title>` and the fallback content of `<iframe>`/`<object>` carry **code or metadata**, and their `textContent` is precisely what must not appear.

The trap survives review because the obvious tests all pass:

- the tag is gone ✅
- `on*` attributes are stripped ✅
- `javascript:` hrefs are dropped ✅
- nothing executes ✅

"Not exploitable" and "not correct" are different questions, and only the first one usually gets asked.

## Fix

Split the decision into three cases:

```ts
const ALLOWED: { [tag: string]: boolean } = {
  P: true, DIV: true, BR: true, B: true, STRONG: true, I: true, EM: true,
  U: true, UL: true, OL: true, LI: true, A: true, SPAN: true, H3: true, H4: true
};

// Content here is code or metadata, not text a reader wanted — drop the whole subtree.
const DROP_WITH_CONTENT: { [tag: string]: boolean } = {
  SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true,
  HEAD: true, TITLE: true, IFRAME: true, OBJECT: true, EMBED: true
};

if (ALLOWED[tag]) {
  /* rebuild + recurse */
} else if (!DROP_WITH_CONTENT[tag]) {
  clean(el, out);          // keep inner text
}                          // else: drop element and everything in it
```

Assert the two sets never overlap — a tag in both would silently delete legitimate content, and it is a one-line check:

```ts
Object.keys(ALLOWED).filter(t => DROP_WITH_CONTENT[t]);   // must be empty
```

`<noscript>` and `<template>` belong in the drop set for a second reason: `DOMParser` runs with scripting disabled and parses their contents as ordinary DOM, whereas assigning to `innerHTML` later parses them with scripting **on** — a payload hidden inside can wake up as a real `<img onerror>` after the round trip.

## Notes

- **Check whether your codebase already has the answer.** In the case that produced this note, the *loose* sanitizer in the same file had been deleting `script`/`style`/`template` with their contents from day one; the strict variant next to it never got the same treatment. When one file holds two flavours of the same guard, diff them against each other — the difference is usually an omission, not a decision.
- **Test for content correctness, not only for execution.** A useful assertion pair: paste a fragment containing `<style>` and assert the stylesheet text is **absent**, and paste one containing a legitimate heading and assert it is **present**.
- Keep the allowlist matched to the content you actually store. A knowledge base that accepts pasted headings needs `H3`/`H4` on the list; a comment box does not. Widening it later is easy, narrowing it silently flattens documents people already saved.
- If the sanitizer is shared across several apps, remember the fix reaches each app only when that app is rebuilt — a fixed library is not a fixed product.
