---
title: A shared package's dynamic import() ships inlined (not lazy-chunked) under module:commonjs
tags: [spfx, webpack, typescript, bundle-size, code-splitting, monorepo, file:link]
applies-to: SPFx app consuming a linked / monorepo TS package that uses dynamic import()
last-reviewed: 2026-07-20
---

# A shared package's dynamic import() ships inlined (not lazy-chunked) under module:commonjs

> **Bottom line.** A linked TS package that `import()`s a heavy library is meant to code-split it into a lazy chunk. If the package is compiled with `module: commonjs`, `tsc` rewrites `import()` to `require()`, which webpack can't split — the library lands in the host app's **main** bundle instead. Set the package's own `module: esnext` so the dynamic import survives into `lib/`.
>
> **Ve zkratce.** Linkovaný TS balíček, který `import()`uje těžkou knihovnu, ji má odštěpit do lazy chunku. Když se balíček kompiluje s `module: commonjs`, `tsc` přepíše `import()` na `require()`, který webpack neumí odštěpit — knihovna skončí v **main** bundlu hostitelské appky. Nastav balíčku vlastní `module: esnext`, ať dynamický import přežije do `lib/`.

## Symptom

You extract some code into a shared TS package (monorepo workspace or a `file:` link) that lazy-loads a
heavy library — `import(/* webpackChunkName: "xlsx" */ 'xlsx')`, or mammoth / a PDF lib — so it stays
out of the host's initial bundle. After wiring it into an SPFx web part and building, the app's **main
bundle jumps by roughly the library's size**, and there is **no separate chunk file** in
`release/assets` (or `dist`). Grepping the main bundle finds the library's internals inside it. The
feature works — the lib is just shipped to every page load instead of on demand.

## Cause

The package is **precompiled to `lib/` by `tsc`** before the host's webpack ever sees it. With
`module: commonjs` (a common base-tsconfig default, since packages are often Node-consumed), `tsc`
lowers a native `import('x')` to something like `Promise.resolve().then(() => require('x'))` — i.e. a
**`require`**. Webpack code-splits only native ES `import()`; a `require` is bundled **inline** into
whatever pulls the package in, which is the host's main entry bundle. The `webpackChunkName` magic
comment is dead once the call is a `require`.

## Fix

Override `module` in the **package's** `tsconfig` (not the app's):

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",        // keep native import() in the emitted lib/
    "moduleResolution": "node"
  }
}
```

`tsc` now leaves `import(...)` in `lib/`, the host's webpack sees a real dynamic import and emits
`chunk.<name>.<hash>.js`, loaded only when that code path runs. Verify:

- `grep "import(" package/lib/TheFile.js` → should show `import(`, **not** `require('theLib')`.
- After the app build, `release/assets/` should contain separate `chunk.*.js` files and the main
  bundle should shrink by the libraries' size.

Two things that bite alongside this:

- **The heavy deps must be resolvable from the package's REAL path.** Webpack resolves the dynamic
  import relative to the module's on-disk location (the linked package dir), **not** the host's
  `node_modules`. Declare the libs as dependencies of the package and install them in the package /
  workspace root — having them only in the host app fails with `Module not found` at build time.
- Emitting ESM (`module: esnext`) from a package whose `package.json` has no `"type": "module"` is
  fine **as long as only a bundler (webpack) consumes it**; a plain Node `require()` of that entry
  would break. For an SPFx-only shared package that's the expected setup.

## Why it's easy to miss

- The feature **works either way** — an inlined library runs perfectly at runtime, so every hand-test
  passes. Only the bundle size and the absence of chunk files reveal it.
- `module: commonjs` in the base tsconfig is a reasonable default for Node-consumable packages, so no
  one thinks to override it per-package.
- The regression is invisible until you diff bundle sizes: the lazy chunk you *expected* silently
  became dead weight on the initial load of every page.
