---
title: A file-size limit doesn't stop a zip bomb — Office extraction needs a decompressed cap
tags: [spfx, files, security, xlsx, docx, pptx, dos]
applies-to: SPFx / browser-side Office extraction (SheetJS, JSZip, mammoth)
last-reviewed: 2026-07-27
---

# A file-size limit doesn't stop a zip bomb — Office extraction needs a decompressed cap

> **Bottom line.** An upload-size cap bounds only the compressed archive — Office files are ZIPs that decompress enormously, so cap the decompressed work: estimate xlsx cells from `!ref` before building the CSV, and bound produced-text length for pptx/docx.
>
> **Ve zkratce.** Limit velikosti nahrávaného souboru hlídá jen zabalený archiv – Office soubory jsou ZIPy s obřím rozbalovacím poměrem, takže omez rozbalenou práci: u xlsx odhadni počet buněk z `!ref` před stavbou CSV a u pptx/docx omez délku vyprodukovaného textu.

## Symptom

Your web part lets users attach `.xlsx` / `.docx` / `.pptx` and extracts the text in the browser
(SheetJS `sheet_to_csv`, JSZip over slide XML, mammoth for Word) to feed an assistant or index.
You cap the upload at, say, 10 MB. A user attaches a file **under** the limit and the whole tab
freezes or the renderer OOMs. Same thing if the extractor runs over a document it *fetched* from a
library (RAG deep-fetch) rather than an upload.

## Cause

`.docx/.xlsx/.pptx` are ZIP archives. Your size check measures the **compressed** bytes; the parser
runs on the **decompressed** content, and Office formats decompress with an enormous ratio:

- **xlsx** — a worksheet whose `<dimension>`/`!ref` is set to `A1:XFD1048576` makes SheetJS
  materialize a CSV of ~17 billion cells from a few KB of XML. `sheet_to_csv` builds the whole
  string before you can truncate it.
- **pptx** — a single `slide1.xml` with deeply nested or repeated nodes inflates to hundreds of MB
  of text; `zip.file(path).async('string')` reads it all into one string.
- **docx** — a bloated `document.xml` does the same through mammoth.

A 10 MB compressed limit still admits a file that expands to gigabytes.

## Fix

Cap the **decompressed** work, and for xlsx do it *before* materializing anything:

```js
// xlsx: estimate cells from the range string, bail before sheet_to_csv
function estimateCellsFromRef(ref) {           // ref like "A1:D100"
  const m = /:([A-Z]+)(\d+)\s*$/.exec(ref || '');
  if (!m) return 0;
  let col = 0;
  for (let i = 0; i < m[1].length; i++) col = col * 26 + (m[1].charCodeAt(i) - 64);
  return col * (parseInt(m[2], 10) || 0);
}
let cells = 0;
for (const name of wb.SheetNames) {
  cells += estimateCellsFromRef(wb.Sheets[name]['!ref']);
  if (cells > MAX_CELLS) throw new Error('File is too large once unpacked.');
}
// then also cap the accumulated CSV length as you build it
```

For pptx/docx you can't cheaply know the uncompressed size up front (JSZip doesn't expose it
reliably), so guard the produced text instead: after each `async('string')`, reject if that one
entry exceeds a hard char cap, and stop once the accumulated extracted text passes a total cap.

Reasonable caps for an assistant context: ~2M cells for xlsx, ~12M chars of produced text total.

## Why it's easy to miss

- The upload-size guard *looks* like the DoS defense — it isn't; it only bounds the archive.
- It never fires on normal files, so it passes every hand-test. You need a crafted `!ref` (or a
  known zip-bomb sample) to trigger it.
- The same extractor is often reused for **fetched** library files, so the attack surface isn't just
  user uploads — anything the code will parse counts.

## Follow-up (2026-07-27): check the cap *before* materializing, from ZIP metadata

The first version of this fix still tested the cap **after** producing the string:

```js
const xml = await zip.files[path].async('string');   // ← 8 MB pptx becomes a 1.5 GB string HERE
if (xml.length > MAX_EXTRACT_CHARS) throw new Error(ZIP_BOMB_MSG);   // too late
```

The tab dies on the line above the check, so the guard never runs. JSZip 3 exposes the declared
uncompressed size per entry after `loadAsync`, so read it first:

```js
/** Declared uncompressed size of a ZIP entry, or null when unavailable. */
function entrySize(file) {
  const d = file && file._data;              // internal, but stable across JSZip 3.x
  const n = d && d.uncompressedSize;
  return typeof n === 'number' ? n : null;   // null → fall back to previous behaviour
}

const size = entrySize(zip.files[path]);
if (size !== null && size > MAX_DECOMPRESSED_BYTES) throw new Error(ZIP_BOMB_MSG);
const xml = await zip.files[path].async('string');
```

Verified against JSZip 3.10.1: a 5 MB entry reports `5242891`, a tiny one `4`; directory entries
report `undefined` (harmless — they never match an `.xml` path filter). Because it is an internal
field, treat `null` as "unknown" and keep the old post-hoc check as a second line of defence rather
than deleting it.

Two extras from the same review:

- **Sum the entries, don't just check each one.** A deck with 200 slides of 40 MB each passes any
  per-entry cap. Track a running total across the entries you extract.
- **SheetJS: bound the parse, not only the output** — `xlsx.read(buf, { type: 'array', sheetRows: N })`
  stops parsing after N rows. And if the limit actually bites, *say so* in the returned text; a
  silently truncated spreadsheet is worse than a refusal, because the answer built on it looks
  complete.
