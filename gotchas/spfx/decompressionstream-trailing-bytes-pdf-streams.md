---
title: "DecompressionStream throws away the whole result when bytes follow the compressed data"
short-title: DecompressionStream and trailing bytes in PDF streams
summary: Inflating a PDF FlateDecode stream in the browser fails completely because a line break sits between the data and `endstream`; trim trailing CR/LF and read chunk by chunk, keeping what arrived before the error
tags: [spfx, pdf, compression, web-streams, browser]
applies-to: DecompressionStream('deflate') in Chrome and Node 24 (both measured 2026-10-28) – any SPFx or browser code that inspects PDF files without a library
last-reviewed: 2026-10-28
---

# DecompressionStream and trailing bytes in PDF streams

> **Bottom line.** A PDF stream's bytes sit between `stream\n` and `endstream`, but there is always a line break (`\n` or `\r\n`) before `endstream`. `DecompressionStream('deflate')` treats those bytes as junk after the end of the data and the whole read fails – in Chrome `new Response(stream).arrayBuffer()` rejects with `TypeError: Failed to fetch`, in Node with `TypeError: Trailing junk found after the end of the compressed stream`. You lose even the data that was already inflated. Trim trailing CR/LF before inflating, read with `getReader()` chunk by chunk, and if the error arrives after some data, keep what you have.
>
> **Ve zkratce.** Obsah proudu PDF leží mezi `stream\n` a `endstream`, ale před `endstream` je vždy konec řádku. `DecompressionStream('deflate')` ho bere jako bajty za koncem dat a celé čtení spadne – v Chrome `TypeError: Failed to fetch` z `arrayBuffer()`, v Node `TypeError: Trailing junk found after the end of the compressed stream`. Přijdete i o to, co se už rozbalilo. Před rozbalením ořízněte koncové CR/LF, čtěte po kouscích přes `getReader()` a když chyba přijde až po datech, platí to, co už přišlo.

## Symptom

A check "is this PDF a scan without text?" looked for fonts or text operators (`/Font`, `Tj`, `TJ`) inside compressed content streams. Every stream came back empty, so a text PDF whose fonts live only in compressed object streams was reported as "unknown", and a real scan was never recognised as a scan.

## Cause

```text
4 0 obj << /Length 25 /Filter /FlateDecode >>
stream
<25 bytes of zlib data>
endstream
```

Slicing from after `stream\n` to the index of `endstream` includes the line break before `endstream`. The zlib data ends before it; the decompressor sees extra bytes and errors. `Response.arrayBuffer()` reports only the error, never the partial result.

## Fix

```ts
async function inflate(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = new Blob([bytes.subarray(0, end)]).stream()
      .pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) { parts.push(value); total += value.length; }
    }
  } catch { if (!total) return undefined; }   // error after data: keep the data
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
```

Trimming alone covers the usual case; reading in chunks also covers streams whose `/Length` is shorter than the slice for other reasons.

## How to verify

Compress a short content stream with `CompressionStream('deflate')`, append `\r\n`, and decompress it with `new Response(...).arrayBuffer()`. It rejects. Without the `\r\n` it returns the original bytes.
