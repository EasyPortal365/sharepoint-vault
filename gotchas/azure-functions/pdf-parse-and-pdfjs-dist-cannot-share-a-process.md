# pdf-parse and pdfjs-dist cannot share a Node process

*Last reviewed: 2026-09-01*

## Symptom

An Azure Function (or any Node service) that extracts PDF text with `pdf-parse` starts
failing with **`bad XRef entry`** — but only on *some* PDFs: synthetic ones, older ones,
simple ones. PDFs exported from modern Word keep working, so smoke tests stay green and
the failures look random.

The trigger: someone added `pdfjs-dist` to the same process (for image extraction,
rendering, vision preprocessing…).

## Cause

`pdf-parse` bundles its own ancient **pdf.js 1.10.100**. Loading a modern `pdfjs-dist`
(3.x) into the same process breaks it:

- the **legacy** build (`pdfjs-dist/legacy/build/pdf.js`) installs global polyfills that
  break the old parser immediately;
- even the **modern** build breaks it *order-dependently*: a `Buffer` created **after**
  `pdfjs-dist` was loaded is misread by the old bundled parser.

Only PDFs with a classic **xref table** are affected. Modern PDFs use an xref **stream**
and take a different parsing path, which is why a Word-export smoke test proves nothing.
In a warm Azure Functions process this shows up **from the second request on**, and it
also poisons *other* functions in the same app (timers, queue triggers) that still use
`pdf-parse`.

## Rule

**One PDF library per process.** When you add `pdfjs-dist`, migrate text extraction to it
too and remove `pdf-parse` entirely — including every side consumer that shares the
process. Text extraction is a few lines:

```js
const pdfjs = require('pdfjs-dist/build/pdf.js'); // 3.11.x — 4.x is ESM-only (no CJS require)
const doc = await pdfjs.getDocument({
  data: new Uint8Array(buffer),
  isEvalSupported: false,          // CVE-2024-4367 mitigation
  disableFontFace: true,
  useSystemFonts: false,
  isOffscreenCanvasSupported: false // Node: force the `data` path for image objects
}).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const tc = await (await doc.getPage(p)).getTextContent();
  // join tc.items[].str, inserting '\n' when transform[5] (Y) changes —
  // byte-for-byte what pdf-parse's default page renderer did
}
await doc.destroy();
```

Guard the regression with a test that feeds a **synthetic xref-table PDF through the real
handler** (you can build one in the test — objects + a computed xref table), not through
a direct library call.

## Bonus trap: test loader ≠ production loader

While diagnosing this we chased a ghost for an hour: in a `.mjs` test, `await import()`
of the CJS `pdf-parse` changed its behaviour (failures depended on whether the Buffer was
read before or after the import). Production (the Functions host) loads CommonJS via
`require`. **Load the code under test with the same loader production uses** — in an
`.mjs` test that means `createRequire(import.meta.url)`, not `await import()`. A test
running under a different loader measures a different runtime, and both its passes and
its failures are meaningless.
