---
title: A module-level cached dynamic import() caches the rejection too
tags: [spfx, webpack, lazy-loading, dynamic-import, error-handling]
applies-to: any webpack/TypeScript app using dynamic import() for lazy chunks (SPFx, React, etc.)
last-reviewed: 2026-07-24
---

# A module-level cached `import()` caches the rejection too

> **Bottom line.** The common "load the library once" pattern — `let p = null; if (!p) p = import('x')` — caches the *promise*, and a rejected promise stays rejected forever. One transient chunk-load failure (flaky network, a CDN/Pages build not live yet) then disables the feature for the rest of the session, even after connectivity is back. Reset the cache to `null` in a `.catch` so the next call retries.
>
> **Ve zkratce.** Oblíbený vzor „načti knihovnu jen jednou" — `let p = null; if (!p) p = import('x')` — cachuje *Promise*, a jednou odmítnutý Promise zůstane odmítnutý navždy. Jediný přechodný výpadek načtení chunku (kolísavá síť, CDN/Pages build ještě není live) pak feature vypne do konce session, i když je síť zpět. Na `.catch` cache vynuluj na `null`, ať příští volání zkusí import znovu.

## Symptom

A lazily-loaded library (diagram renderer, xlsx/docx parser, a heavy editor) works normally, but after a single blip — the user was briefly offline, or the freshly-deployed chunk hash wasn't live on the CDN yet — the feature stays broken for the *entire* session. Every subsequent attempt fails instantly with the same error, and only a hard page reload fixes it. The network tab shows **no retry request** on later attempts.

```ts
let libPromise: Promise<Lib> | null = null;

async function getLib(): Promise<Lib> {
  if (!libPromise) {
    libPromise = import(/* webpackChunkName: "lib" */ 'lib').then(m => init(m.default));
  }
  return libPromise;   // ← once this rejects, every future caller gets the same rejection
}
```

## Cause

You're memoizing the **promise**, not its resolved value. A promise that rejects is a permanently-settled rejected promise — awaiting it again re-throws the same error without re-running anything. Because `libPromise` is now a non-null (rejected) promise, the `if (!libPromise)` guard is never true again, so `import()` is never retried. The dynamic `import()` itself *would* refetch the chunk on a fresh call (webpack doesn't cache a failed chunk load), but your guard never lets it.

Component-level retry (a React error state with a "try again" button that calls `getLib()` again) does **not** help while the module-level cache is poisoned — it hands back the same dead promise.

## Fix

Clear the cache in a `.catch` and rethrow, so a failure is not memoized:

```ts
let libPromise: Promise<Lib> | null = null;

async function getLib(): Promise<Lib> {
  if (!libPromise) {
    libPromise = import(/* webpackChunkName: "lib" */ 'lib')
      .then(m => init(m.default))
      .catch(err => {
        libPromise = null;   // don't memoize a transient failure — let the next call retry
        throw err;           // still reject THIS call so the caller can show a fallback
      });
  }
  return libPromise;
}
```

The success path still caches (the library loads at most once); only failures reset. Callers that show a fallback on error now get a real retry the next time they ask.

## Why it's easy to miss

- On a fast, reliable dev network the import essentially never fails, so the poisoned-cache path never runs in testing.
- The pattern looks obviously correct — "cache it so we only load once" — and the success case behaves perfectly.
- It bites worst right after a deploy: the new chunk hash may be 404 for a minute (GitHub Pages / CDN build lag), every early visitor poisons the cache, and the feature looks dead until they reload.

## See also

- `gotchas/spfx/shared-package-dynamic-import-inlines-with-commonjs.md` — make sure the `import()` actually produces a lazy chunk (needs `module: esnext`) before you worry about caching it.
