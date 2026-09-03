---
title: Uploaded .html grows after you set column values — SharePoint injects mso document properties (and rewrites Office files on upload)
tags: [libraries, rest-api, upload, verification, ooxml, docx, property-promotion]
applies-to: SharePoint Online
last-reviewed: 2026-09-03
---

# Uploaded .html grows after you set column values — SharePoint injects mso document properties (and rewrites Office files on upload)

> **Bottom line.** Upload an `.html` file to a library and then write values into the library's own columns: SharePoint **rewrites the file** and stores those values inside it as Office document properties. A byte-for-byte or SHA-1 read-back check then fails even though the upload was fine. Opaque binaries (`.pdf`, images) are untouched and hash exactly. **Office Open XML packages (`.docx`, `.xlsx`, `.pptx`) are rewritten on the upload itself**, before any column is written — their size and hash never match the source.
>
> **Ve zkratce.** Když do knihovny nahraješ `.html` a pak mu vyplníš vlastní sloupce, SharePoint soubor přepíše a hodnoty do něj vloží jako dokumentové vlastnosti. Kontrola přes SHA-1 pak neprojde, i když je upload v pořádku. Neprůhledné binárky (`.pdf`, obrázky) zůstávají beze změny. **Soubory Office (`.docx`, `.xlsx`, `.pptx`) SharePoint přepíše už při samotném nahrání** – jejich velikost ani hash se zdrojem nikdy nesedí.

## Symptom

A publish routine uploads a file, sets its metadata, then reads the file back and compares hashes — the standard way to prove the write landed:

```js
await fetch(`${site}/_api/web/GetFolderByServerRelativeUrl('${folder}')/Files/add(overwrite=true,url='${name}')`,
  { method: 'POST', headers: { 'X-RequestDigest': digest }, credentials: 'include', body: buffer });

// set the library's own columns on the new item
await fetch(`${site}/_api/web/lists/getbytitle('Docs')/items(${itemId})`,
  { method: 'POST', headers: { 'X-HTTP-Method': 'MERGE', 'IF-MATCH': '*', /* … */ },
    body: JSON.stringify({ ProductId: 18, Kind: 'file' }) });

const back = await fetch(`${site}/_api/web/GetFileByServerRelativeUrl('${folder}/${name}')/$value`,
  { credentials: 'include', cache: 'no-store' }).then(r => r.arrayBuffer());
sha1(back) === sha1(buffer);   // false for .html, true for .pdf
```

Measured on one page: source 25 018 B, stored 25 419 B — 401 bytes larger, with no visible change to the rendered page.

## Cause

For file types it recognises as Office-compatible markup, SharePoint persists list column values **into the file itself**, the same mechanism Word/FrontPage used. It adds:

- namespace declarations on the root element: `<html lang="cs" xmlns:mso="urn:schemas-microsoft-com:office:office" xmlns:msdt="uuid:C2F41010-65B3-11d1-A29F-00AA00C14882">`
- an `<xml><mso:CustomDocumentProperties>…</mso:CustomDocumentProperties></xml>` block in `<head>`, carrying one element per populated column
- a `<!--[if gte mso 9]><![endif]-->` conditional comment before `</head>`

All three are inert in a browser — the page renders exactly as authored. For HTML the rewrite happens on the **metadata write**, not on the upload, so uploading without touching columns leaves the bytes alone.

## Office files are rewritten on the upload itself

The "upload alone leaves the bytes alone" part holds for HTML and for opaque binaries — **not for Office Open XML**. SharePoint parses `.docx`/`.xlsx`/`.pptx` packages as they arrive (document property promotion) and writes its own parts into the package: `docProps/core.xml`, `docProps/app.xml` and `docProps/custom.xml` (content type id and friends), plus their relationships and content-type entries.

Measured with plain `POST …/Files/add(url=@n,overwrite=false)` and **no** column write afterwards, on minimal hand-built packages that carried no `docProps` at all:

| File | On disk | In the library right after upload |
|---|---|---|
| minimal `.docx` (document.xml + rels + content types) | 2 170 B | 9 152 B |
| second minimal `.docx` | 1 964 B | 8 946 B |
| `.pdf` uploaded the same way | 132 852 B | 132 852 B |

The `Length` you read back from `GetFileByServerRelativePath(...)?$select=Length` is the rewritten size, and the PDF is the only one of the three that still matches.

## Rule

Verify HTML by content, not by bytes. Either strip what SharePoint added before comparing:

```js
const clean = back
  .replace(/<html([^>]*)>/, '<html$1>'.replace(/\s+xmlns:(mso|msdt)="[^"]*"/g, ''))
  .replace(/<xml>[\s\S]*?<\/xml>\s*/g, '')
  .replace(/<!--\[if gte mso 9\]><!\[endif\]-->\s*/, '');
```

…or drop the hash for markup and assert on the payload instead — a marker string that only the new version contains, plus a structural count (sections, rows). Keep the SHA-1 check for opaque binaries, where it is exact and worth having.

For Office files, never use size or hash to answer "is the library copy the version I published?" — it is always "no". Either keep the check to PDF (the format that survives upload byte-for-byte), read a marker from the package (`word/document.xml` text, a custom property you set yourself), or record your own version stamp in a column at upload time and compare that.

Two related traps:

- **Don't "fix" the difference by re-uploading.** Each metadata write re-injects the block, so a hash-driven retry loop never converges.
- **Don't let the properties leak.** The injected block contains your column values verbatim; if the file is later shared outside the tenant, internal field values travel with it.
