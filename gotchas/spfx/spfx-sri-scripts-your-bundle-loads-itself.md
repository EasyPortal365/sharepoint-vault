---
title: "Manifest SRI does not cover scripts your SPFx bundle loads itself (pdf.js, tesseract.js, workers)"
summary: Pinning the loader in the .sppkg and giving every manifest path and webpack chunk an integrity hash still leaves a hole – third-party libraries your own code injects with a script tag, fetches for a worker or that a worker pulls in with importScripts run unverified; keep their SRI hashes in the already verified bundle, set the integrity attribute (not the property), fetch worker code with integrity into a blob, and for tesseract.js 5 concatenate core and worker into one blob so importScripts is skipped
tags: [spfx, security, sri, cdn, web-worker, pdfjs, tesseract, supply-chain]
applies-to: SPFx web parts that load vendor libraries at runtime from a CDN (measured on SPFx 1.22.2, pdf.js 3.11.174, tesseract.js 5.1.1, SharePoint Online, November 2026)
last-reviewed: 2026-11-11
---

# Manifest SRI does not cover scripts your SPFx bundle loads itself

> **Bottom line.** Subresource Integrity in SPFx only reaches two paths: script resources in the component manifest (`{ path, integrity }`) and webpack chunks (if you add a chunk-hash map to your build). Anything your code downloads by itself – a vendor UMD build injected with `<script>`, a worker script fetched into a `blob:` URL, or code a worker pulls in with `importScripts` – is outside both, so a tampered file on the CDN still runs on the SharePoint page. Put the SRI hashes of those files into your own bundle (which is already verified), refuse any file without a hash, set `integrity` and `crossorigin` as **attributes** on the script element, fetch worker code with `fetch(url, { integrity })` and start the worker from a `blob:` URL of the verified text. A smoke test that checks `script[integrity]` after page load will not notice the gap: these libraries load only when the user opens a PDF or a scan.
>
> **Ve zkratce.** SRI v SPFx pokryje jen zdroje v manifestu a chunky webpacku. Knihovny, které si kód appky stahuje sám (`<script>`, `fetch` pro worker, `importScripts` ve workeru), běží bez ověření. Otisky jejich souborů dej do vlastního, už ověřeného bundlu, soubor bez otisku nenačítej, `integrity` a `crossorigin` nastav jako atributy, kód workeru stáhni `fetch` s `integrity` a spusť ho z `blob:`. Kontrola `script[integrity]` po načtení stránky díru neukáže – knihovny přijdou až s prvním PDF nebo skenem.

## Symptom

Your web part already does everything the manifest-SRI recipe asks for: the bootstrap is pinned from the `.sppkg`, the library and its lazy chunks carry `integrity`, and the browser refuses tampered bytes. But the app also renders PDFs with pdf.js and reads scans with tesseract.js, both served from a `vendor/` folder on the same CDN (tenant CSP often allows scripts only from your app's folder, so a public CDN is not an option). Those files load without any hash:

- `pdf.min.js` – `document.createElement('script')`, `src` set, appended to `<head>`;
- `pdf.worker.min.js` – `fetch` → `Blob` → `new Worker(blobUrl)`;
- `tesseract.min.js` – `<script>`; its worker then calls `importScripts(corePath)` to load the WebAssembly core from the CDN.

## Cause

The SPFx loader adds `integrity` only to what it loads from a manifest; a webpack chunk-SRI plugin only to chunks webpack itself requests. Your own `<script>` element, your own `fetch` and a worker's `importScripts` are invisible to both.

## Fix

1. **Hashes in the verified bundle.** A constant map `relative path → sha384-…` in your code. Any URL that is not in the map throws before anything is requested.
2. **Script tag:**
   ```ts
   const s = document.createElement('script');
   s.setAttribute('integrity', sri);          // attribute, not s.integrity
   s.setAttribute('crossorigin', 'anonymous'); // CDN must send Access-Control-Allow-Origin
   s.src = url;
   ```
   Use the attribute: jsdom (20.0.3, the version Jest uses in SPFx 1.22) does not reflect the `integrity` property, so a unit test reading `getAttribute('integrity')` would see `null`. Browsers treat both forms the same.
3. **Worker:** `const text = await (await fetch(url, { integrity: sri, credentials: 'omit' })).text();` – a mismatch rejects with `TypeError`. Start the worker with `new Worker(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })))`.
4. **Worker that calls `importScripts` itself (tesseract.js 5.1.1):** fetch both the core and the worker script with integrity and concatenate them into **one** blob (`[core, '\n;\n', worker]`). The worker skips `importScripts` when the global `TesseractCore` already exists. Pass `workerPath: blobUrl` and `workerBlobURL: false`, otherwise tesseract wraps the path in its own blob that calls `importScripts(<CDN URL>)` again.
5. **Test the hashes against what is deployed**, e.g. `git cat-file blob HEAD:<path>` in the CDN repository – not the working copy, where `core.autocrlf` may have changed the bytes.

What stays unverified: data files such as OCR language models (`*.traineddata.gz`). They are not code; decide whether that is acceptable for you.

## Related

- [spfx-sri-integrity-via-manifest-path.md](spfx-sri-integrity-via-manifest-path.md) – the manifest and `.sppkg` part of the chain
