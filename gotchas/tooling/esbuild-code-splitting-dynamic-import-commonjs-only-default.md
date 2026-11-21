---
title: Dynamic import of a CommonJS package under esbuild code splitting exposes only `default`
summary: "await import('mammoth') works in an SPFx (webpack) bundle but throws 'extractRawText is not a function' in an esbuild build with splitting: true, because the split chunk exports only default. A single-file esbuild test passes anyway. Fall back to m.default and test with the same splitting as production"
tags: [esbuild, webpack, commonjs, dynamic-import, code-splitting, office-add-in, spfx, mammoth]
applies-to: Shared TypeScript code that lazy-loads a CommonJS library (mammoth, SheetJS, JSZip, ...) and is bundled both by SPFx/webpack and by esbuild (Office add-ins, Teams tabs, plain web pages)
last-reviewed: 2026-11-21
---

# Dynamic import of a CommonJS package under esbuild code splitting exposes only `default`

> **Bottom line.** `const m = await import('mammoth'); m.extractRawText(...)` works in an SPFx web part, because webpack puts a CommonJS module's exports straight on the namespace. Built with esbuild and `splitting: true`, the library lands in its own chunk that exports only `default`, so `m.extractRawText` is `undefined` and you get "is not a function". Without splitting esbuild copies the properties over, so a single-file test passes and hides the bug. Always fall back to `m.default`, and test shared code with the same bundler settings as production.
>
> **Ve zkratce.** `const m = await import('mammoth'); m.extractRawText(...)` ve webpartu SPFx funguje, protože webpack dá exporty CommonJS modulu přímo do jmenného prostoru. V esbuildu se `splitting: true` skončí knihovna ve vlastním chunku, který exportuje jen `default` – `m.extractRawText` je `undefined` a padá „is not a function“. Bez dělení esbuild vlastnosti zkopíruje, takže test v jednom souboru projde a chybu schová. Vždy přidej fallback na `m.default` a sdílený kód testuj se stejným nastavením balení jako produkce.

## Symptom

- A shared helper reads `.docx` files with `await import('mammoth')`. It works in every SPFx app.
- The same helper inside an Office add-in (or any page bundled by esbuild with code splitting) fails with `TypeError: (intermediate value).extractRawText is not a function`.
- If the caller wraps the work in a generic `try/catch`, the user only sees "Something went wrong, try again", while every REST call in the network log returns 200.

## Cause

Webpack's interop for `import()` of a CommonJS module gives you a namespace that has both the named properties and `default`.

esbuild behaves differently depending on splitting:

- **No splitting (one output file):** the `__toESM` helper creates a namespace and copies the module's own properties onto it, so `m.extractRawText` exists.
- **`splitting: true` (ESM output with chunks):** the CommonJS library is emitted as a separate chunk whose ES module exports only `default` (the `module.exports` object). The namespace you get from `import('./chunk.js')` has `default` and nothing else.

That is also why a unit test bundled as a single file passes: it never builds the chunk that production loads.

## Fix

Pick whichever shape the bundler produced:

```ts
type Mammoth = { extractRawText(i: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };

const mod = (await import('mammoth')) as unknown as Mammoth & { default?: Mammoth };
const mammoth = typeof mod.extractRawText === 'function' ? mod : mod.default;
if (!mammoth || typeof mammoth.extractRawText !== 'function') {
  throw new Error('The Word reader could not be loaded.');
}
const { value } = await mammoth.extractRawText({ arrayBuffer });
```

The same applies to any CommonJS library you load lazily: SheetJS (`xlsx`), JSZip, `pdfjs` legacy builds, and so on.

## Test it the way it ships

A regression test only proves something if it is bundled like production:

```js
// test runner: build browser-targeted tests with the same splitting as the app
await build({
  entryPoints: browserTests,
  outdir: OUT,
  bundle: true,
  format: 'esm',
  platform: 'browser',   // browser builds of dependencies (mammoth without fs)
  splitting: true,       // without this the bug does not reproduce
  chunkNames: 'chunks/[name]-[hash]',
  external: ['node:*'],
});
```

Under Node you may need a tiny `FileReader` shim for code that reads `Blob`s. Then check the test fails with the fallback removed and passes with it.

## Diagnosing it inside an Office add-in

- Right-click inside the task pane → **Inspect** opens DevTools for the pane's WebView2 (Office on Windows).
- In **Sources**, tick **Pause on caught exceptions** and repeat the action: the debugger stops on the exact line, even when the code swallows the error.
- Make multi-step error messages say which step failed (`step: reading the old version, TypeError`). "Try again" with no cause can't be reported or diagnosed.
