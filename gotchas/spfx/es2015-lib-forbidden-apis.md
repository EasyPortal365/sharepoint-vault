---
title: SPFx build fails on padStart, includes, Object.values — the ES2015 lib trap
tags: [spfx, typescript, build]
applies-to: SharePoint Online (SPFx)
last-reviewed: 2026-07-15
---

# SPFx build fails on `padStart`, `includes`, `Object.values` — the ES2015 `lib` trap

> **Bottom line.** SPFx ships `lib: ES2015`, so post-2015 APIs like `padStart`/`includes`/`Object.values` fail type-checking with TS2550 — use ES2015 equivalents (safe on every runtime) or raise `lib`, which fixes the check but polyfills nothing.
>
> **Ve zkratce.** SPFx má `lib: ES2015`, takže novější API jako `padStart`/`includes`/`Object.values` neprojdou typovou kontrolou (TS2550) – použij ES2015 náhrady (bezpečné na každém runtime), nebo zvedni `lib`, což opraví kontrolu, ale nic nepolyfilluje.

## Symptom

Code runs fine in the browser during development, then the build fails:

> TS2550: Property 'padStart' does not exist on type 'string'. Do you need to change your target library?

Same story for `Array.prototype.includes`, `Object.values`, `Object.entries`, `flat`, `replaceAll`, `Promise.allSettled`, `Promise.finally`, …

## Cause

SPFx projects ship with `"lib": ["ES2015", ...]` in `tsconfig.json`. Anything added to JavaScript *after* ES2015 is missing from the type definitions, so TypeScript rejects it — even though evergreen browsers support it at runtime.

## Fix

Two options:

**A. Stay on ES2015 and use equivalents** — zero risk, works everywhere:

| Instead of | Use |
|---|---|
| `str.padStart(2, '0')` | `('0' + n).slice(-2)` or a tiny `pad()` helper |
| `arr.includes(x)` | `arr.indexOf(x) !== -1` |
| `Object.values(o)` / `Object.entries(o)` | `Object.keys(o).map(k => o[k])` |
| `arr.flat()` / `arr.flatMap(f)` | `arr.reduce((a, b) => a.concat(b), [])` |
| `str.replaceAll(a, b)` | `str.split(a).join(b)` |
| `arr.at(-1)` | `arr[arr.length - 1]` |
| `Promise.allSettled(ps)` | wrap each: `p.then(v => ({ ok: true, v }), e => ({ ok: false, e }))` |
| `str.matchAll(re)` | `re.exec()` loop with the `g` flag |
| `promise.finally(f)` | call `f` from both `.then()` and `.catch()` |

**B. Raise `lib`** (add `"ES2017.String"`, or move to `"ES2019"`): quick — but remember `lib` only changes *type checking*. It polyfills nothing. If your code can end up on older runtimes (embedded webviews, kiosk browsers), option A is the safe bet.

`async/await` is fine either way — the SPFx toolchain transpiles it.

## Notes

- Error numbers to recognize on sight: **TS2550** (missing lib API) and its cousin **TS2802** (iterating a `Set`/`Map` without `downlevelIteration`).
- Sneaky cases that trip the same wire: spreading a `Set` into an array, `Blob.arrayBuffer()` (use `FileReader`), `String.prototype.trimStart`.
