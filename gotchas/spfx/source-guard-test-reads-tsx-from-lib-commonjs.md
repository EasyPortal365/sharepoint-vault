---
title: "A Jest test that reads a .tsx source file passes locally and fails in the SPFx production build"
short-title: Source-reading Jest test fails under heft (runs from lib-commonjs)
summary: Heft runs Jest over the compiled `lib-commonjs` output, where only `.js` exists – `fs.readFileSync(path.join(__dirname, 'X.tsx'))` throws ENOENT; map `__dirname` back to `src` before reading
tags: [spfx, heft, jest, testing, build]
applies-to: SPFx 1.18+ projects built with heft (`heft test --clean --production`)
last-reviewed: 2026-11-17
---

# A Jest test that reads a .tsx source file passes locally and fails in the SPFx production build

> **Bottom line.** In an SPFx project, heft runs Jest over the **compiled** output in `lib-commonjs`, not over `src`. Only `.js` files land there. A "source guard" test that does `fs.readFileSync(path.join(__dirname, 'MyComponent.tsx'))` therefore throws `ENOENT` in the release build. Map the directory back to `src` first: `__dirname.replace(/([\\/])lib-commonjs([\\/])/, '$1src$2')`.
>
> **Ve zkratce.** Heft v SPFx spouští Jest nad PŘELOŽENÝM výstupem v `lib-commonjs`, ne nad `src`, a tam jsou jen `.js` soubory. Test, který čte zdrojový `.tsx` přes `__dirname`, v produkčním buildu spadne na `ENOENT`. Cestu nejdřív převeďte zpět na `src`: `__dirname.replace(/([\\/])lib-commonjs([\\/])/, '$1src$2')`.

## Symptom

You add a small guard test that reads a component's source and asserts it calls a shared helper. The check catches the case where someone later swaps the helper for a hand-rolled copy:

```ts
const src = fs.readFileSync(path.join(__dirname, 'DocPreview.tsx'), 'utf8');
expect(src).toMatch(/return urlPathExt\(url\);/);
```

The functional assertions in the same file pass. The release build (`heft test --clean --production`) stops with:

```
ENOENT: no such file or directory, open '…\lib-commonjs\webparts\…\DocPreview.tsx'
```

## Cause

Heft compiles TypeScript first, then runs Jest over `lib-commonjs/**/*.test.js`. At run time `__dirname` points inside `lib-commonjs`, which holds `.js` files only. The `.tsx` exists solely under `src`. A Jest run started straight from `src` (via ts-jest or an IDE runner) resolves `__dirname` to `src` and never shows the problem.

## Fix

Resolve the source directory explicitly:

```ts
// Tests run from compiled lib-commonjs; the .tsx source only exists in src.
const SRC_DIR = __dirname.replace(/([\\/])lib-commonjs([\\/])/, '$1src$2');
const src = fs.readFileSync(path.join(SRC_DIR, 'DocPreview.tsx'), 'utf8');
```

The replacement is a no-op when the test already runs from `src`, so the same code works in both runners. An alternative is to walk up from `__dirname` until a `src/<relative path>` exists.

Validate any new test that reads files through the project's own test command (`npm test` → heft), never only through a standalone `jest` run.
