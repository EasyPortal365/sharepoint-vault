---
title: Load an SPFx bundle's lazy chunk from the browser console — no clicking through the UI
summary: "Push a fake chunk with a runtime callback into the bundle's `webpackJsonp_<id>` array to get its real `__webpack_require__`, then `req.e(chunkId)` loads the chunk exactly as the app would — for checking 404s, SRI `integrity` or CSP on features you would rather not trigger"
tags: [spfx, webpack, lazy-loading, chunks, smoke-test, sri, debugging]
applies-to: SharePoint Online, SPFx bundles built with webpack 5 (verified on SPFx 1.22.2)
last-reviewed: 2026-11-11
---

# Load an SPFx bundle's lazy chunk from the browser console — no clicking through the UI

> **Bottom line.** A lazy chunk is only tested when something calls `import()`, and the feature behind it may be expensive or have side effects (an AI call, an import that writes, an email). You do not need the feature: every webpack 5 bundle exposes a global `self.webpackJsonp_<id>` array, and pushing `[[fakeId], {}, callback]` into it makes webpack call your callback with the bundle's own `__webpack_require__`. `req.e(chunkId)` then loads the chunk through the real runtime — same URL, same public path, same `integrity` and `crossOrigin` hooks — and only registers its modules; no module code runs.
>
> **Ve zkratce.** Líně načítaný chunk je otestovaný, jen když něco zavolá `import()`, a funkce za ním může být drahá nebo mít vedlejší účinky (volání AI, import, který zapisuje, e-mail). Funkci nepotřebuješ: každý bundle z webpacku 5 má globální pole `self.webpackJsonp_<id>` a když do něj pushneš `[[falešnéId], {}, callback]`, webpack zavolá tvůj callback s vlastním `__webpack_require__` bundlu. `req.e(chunkId)` pak načte chunk skutečným runtime – stejná adresa, stejný public path, stejné háčky `integrity` a `crossOrigin` – a jen zaregistruje jeho moduly; kód modulů se nespustí.

## When to use it

- Post-release smoke test of a component whose chunks moved to a new folder (see the related gotcha below) — every `chunk.*` must answer 200.
- Checking that a build step really puts `integrity` on chunk `<script>` tags and that the browser accepts the hash.
- A tenant CSP or a proxy that might block the CDN only for late-loaded scripts.

## Snippet

Run it in the console of a page where the component has already loaded its entry bundle.

```js
// 1) Find the bundle's JSONP array: open any chunk file of the bundle — it starts with
//    (self.webpackJsonp_<32 hex>=self.webpackJsonp_<32 hex>||[]).push([[<chunkId>], …
const g = 'webpackJsonp_0123456789abcdef0123456789abcdef';   // ← from the chunk file
const chunkId = 774;                                            // ← the [[…]] number in that file

// 2) Borrow the bundle's own __webpack_require__ (the third element is a runtime callback)
let req = null;
self[g].push([['probe' + Date.now()], {}, r => { req = r; }]);

// 3) Load the chunk through the real runtime
try { await req.e(chunkId); console.log('chunk ' + chunkId + ' loaded'); }
catch (e) { console.error('chunk ' + chunkId + ' failed:', e); }   // ChunkLoadError = 404, CSP or SRI

// 4) Inspect what the runtime inserted (webpack may remove the tag after load — read it right away)
[...document.querySelectorAll('script[src*="chunk."]')]
  .map(s => s.src + ' integrity=' + (s.integrity || '–') + ' crossorigin=' + s.crossOrigin);
```

`self[g]` does not exist until the entry bundle has run — load the component first (open the page, select a list item for a command set, …).

## Proving the browser enforces the hash

With a chunk that loaded with `integrity`, add the same file once more with a hash nothing can match — the browser must refuse it:

```js
await new Promise(res => {
  const s = document.createElement('script');
  s.crossOrigin = 'anonymous';
  s.integrity = 'sha384-' + btoa(String.fromCharCode(...new Uint8Array(48)));  // valid form, never matches
  s.src = '<chunk url>?neg=' + Date.now();
  s.onload = () => res('loaded — NOT enforced');
  s.onerror = () => res('blocked — enforced');
  document.head.appendChild(s);
});
```

Use a well-formed digest: a malformed `integrity` value is ignored by the browser ([SRI spec](https://www.w3.org/TR/SRI/)) and the script runs.

## Notes

- The fake chunk id is harmless: webpack marks it as installed and nothing ever requests it.
- `req.e()` resolves the chunk's whole dependency set, like `import()` would; the modules stay unevaluated until something calls `req(moduleId)`.
- Chunk ids are numeric in production builds (named chunks keep their name only in the file name), so read the id from the file, not from the name.
- Related: [A library component loaded from your own manifest fetches its lazy chunks from that manifest's folder](library-component-lazy-chunks-load-from-the-manifest-folder.md) — the failure this check catches.
- Webpack's JSONP chunk format and the runtime callback: [webpack — Under the hood](https://webpack.js.org/concepts/under-the-hood/).
