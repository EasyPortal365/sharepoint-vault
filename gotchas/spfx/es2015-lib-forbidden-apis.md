---
title: SPFx build fails on padStart, includes, Object.values — the ES2015 lib trap
short-title: The ES2015 `lib` trap
summary: TS2550 on `padStart` & friends, and the safe equivalents
tags: [spfx, typescript, build]
applies-to: SharePoint Online (SPFx)
last-reviewed: 2026-09-25
---

# SPFx build fails on `padStart`, `includes`, `Object.values` — the ES2015 `lib` trap

> **Bottom line.** SPFx's `lib` stops at ES2015, so post-2015 APIs like `padStart`/`includes`/`Object.values` fail type-checking with TS2550 — use ES2015 equivalents (safe on every runtime) or raise `lib`, which fixes the check but polyfills nothing.
>
> **Ve zkratce.** SPFx má `lib` jen do ES2015, takže novější API jako `padStart`/`includes`/`Object.values` neprojdou typovou kontrolou (TS2550) – použij ES2015 náhrady (bezpečné na každém runtime), nebo zvedni `lib`, což opraví kontrolu, ale nic nepolyfilluje.

## Symptom

The code works in every current browser, yet the build fails:

> TS2550: Property 'padStart' does not exist on type 'string'. Do you need to change your target library?

Same story for `Array.prototype.includes`, `Object.values`, `Object.entries`, `flat`, `replaceAll`, `Promise.allSettled`, `Promise.prototype.finally`, …

## Cause

SPFx projects compile with `target: es5` and a `lib` list that stops at ES2015 — `es5`, `dom` and a few ES2015 parts (`es2015.core`, `es2015.collection`, `es2015.iterable`, `es2015.promise`, `es2015.proxy`; in SPFx 1.22 inherited from the web build rig's `tsconfig-base.json`). Anything added to JavaScript *after* ES2015 is missing from the type definitions, so TypeScript rejects it — even though evergreen browsers support it at runtime.

## Fix

Two options:

**A. Stay on ES2015 and use equivalents** — zero risk, works everywhere:

| Instead of | Use |
|---|---|
| `str.padStart(2, '0')` | `('0' + n).slice(-2)` for 0 to 99 (date and time parts), otherwise a tiny `pad()` helper |
| `arr.includes(x)` | `arr.indexOf(x) !== -1` (differs only for `NaN`) |
| `Object.values(o)` / `Object.entries(o)` | `Object.keys(o).map(k => o[k as keyof typeof o])` / `… => [k, o[k as keyof typeof o]]` — under `strict`, plain `o[k]` fails with TS7053 |
| `arr.flat()` / `arr.flatMap(f)` | `arr.reduce((a, b) => a.concat(b), [])` / `arr.map(f).reduce(…)` |
| `str.replaceAll(a, b)` | `str.split(a).join(b)` for a string `a` (`b` goes in literally, `$&` is not expanded) |
| `arr.at(-1)` | `arr[arr.length - 1]` |
| `Promise.allSettled(ps)` | wrap each: `p.then(v => ({ ok: true, v }), e => ({ ok: false, e }))`, then `Promise.all` |
| `str.matchAll(re)` | `re.exec()` loop with the `g` flag |
| `promise.finally(f)` | `promise.then(v => { f(); return v; }, e => { f(); throw e; })` |

**B. Raise `lib`** (add `"ES2017.String"`, or move to `"ES2019"`): quick — but remember `lib` only changes *type checking*. It polyfills nothing. If your code can end up on older runtimes (embedded webviews, kiosk browsers), option A is the safe bet.

`async/await` is fine either way — the SPFx toolchain transpiles it.

## Notes

- Error numbers to recognize on sight: **TS2550** (missing lib API) and its cousin **TS2802** (iterating a `Set`/`Map` without `downlevelIteration`).
- Sneaky cases that trip the same wire: spreading a `Set` into an array (TS2802; use `Array.from(set)`) and `String.prototype.trimStart`. `Blob.arrayBuffer()` is not one of them: it is a DOM API declared in TypeScript's `lib.dom`, and it type-checks in SPFx 1.22.
- **A check outside the project can pass when the build won't.** A standalone `tsc --lib es5,es2015.promise snippet.ts` loads every `@types/*` package in `node_modules`, and current `@types/node` contains `/// <reference lib="es2020" />` — APIs from ES2016 through ES2020 then type-check and TS2550 never shows. SPFx 1.22 limits `types` to `heft-jest` and `webpack-env`, so the real build fails on the same code. Check snippets against the project's own config (a small `tsconfig` that `extends` it and lists the snippet in `files`), or at least set `"types": []`.
