---
title: "A blob URL runs the SVG that SharePoint refused to render — the server's `Content-Disposition` does not travel with `resp.blob()`"
short-title: "A blob URL runs the SVG SharePoint refused to render"
summary: SharePoint serves library SVG and HTML as an attachment with nosniff, so an iframe on the file URL shows nothing; fetch it, call resp.blob() and iframe the object URL, and the script inside runs on the tenant origin — build the Blob with a type from an extension allow-list instead
tags: [security, xss, svg, blob, iframe, content-disposition, preview, print, spfx]
applies-to: SharePoint Online document libraries; any client code (SPFx, extensions, scripts) that previews or prints a library file through a blob URL
last-reviewed: 2026-11-16
---

# A blob URL runs the SVG that SharePoint refused to render

> **Bottom line.** SharePoint Online protects you when a file is opened by its own URL: library SVG and HTML come back with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so an `<iframe>` on the file URL renders nothing and a script inside the SVG never runs. The protection lives in the **response headers**. `fetch()` → `resp.blob()` keeps only the body and the `Content-Type` (`image/svg+xml`), and `URL.createObjectURL()` gives that blob the **origin of your page** — the tenant. An iframe on that object URL renders the SVG inline and its script runs with the viewer's SharePoint session. Build the Blob yourself with a type taken from an extension allow-list (`new Blob([data], { type: 'application/pdf' })`), and do not preview types that are not on the list.
>
> **Ve zkratce.** SharePoint Online chrání soubor otevřený vlastní adresou: SVG a HTML z knihovny posílá s `Content-Disposition: attachment` a `nosniff`, takže iframe na adrese souboru nic nevykreslí a skript v SVG neběží. Ochrana je ale v **hlavičkách odpovědi**. `fetch()` → `resp.blob()` si nese jen tělo a `Content-Type` (`image/svg+xml`) a `URL.createObjectURL()` dá blobu **původ vaší stránky** – tenant. Iframe na takové adrese SVG vykreslí a jeho skript poběží se SharePointovou relací čtenáře. Blob sestavte sami s typem podle povolené přípony (`new Blob([data], { type: 'application/pdf' })`) a typy mimo seznam v náhledu nezobrazujte.

## Symptom

A preview or print feature fetches the selected file and shows it in an iframe through an object URL — a common pattern, because it lets the page call `contentWindow.print()` or hide SharePoint's own viewer chrome:

```js
const resp = await fetch(fileUrl, { credentials: 'same-origin' });
const blob = await resp.blob();                 // type = whatever the server said
frame.src = URL.createObjectURL(blob);          // blob:https://<tenant>.sharepoint.com/…
```

For PDFs and images it works. Nobody notices that a contributor who uploads an `.svg` with a `<script>` element now has script running in every reader's tenant session the moment the reader prints or previews that file.

## Cause

Measured on SharePoint Online on 2026-11-16 with a harmless SVG whose script only set a flag on `window.parent`:

| What the iframe pointed at | Response / blob type | Script ran |
|---|---|---|
| The library file URL | `image/svg+xml`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` | **no** |
| `URL.createObjectURL(await resp.blob())` | blob type `image/svg+xml` | **yes** |
| `URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))` | `application/pdf` | no |

`Content-Disposition` and `nosniff` are properties of an HTTP response. A `Blob` has a body and a MIME type, nothing else, so the browser has no reason to treat it as a download — and a blob URL is same-origin with the document that created it. Checking `resp.headers.get('content-type')` for `text/html` does not close the gap either: `image/svg+xml` is not HTML and still executes, and so do XML types with an XHTML namespace.

## Fix

Decide the type from the file name, not from the server, and refuse what is not on the list:

```js
const PRINT_MIME = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp'
};

async function blobForFrame(fileUrl, ext) {
  const mime = PRINT_MIME[String(ext || '').toLowerCase()];
  if (!mime) return null;                       // svg, html, xml, xhtml, mht… → open in a new tab instead
  const resp = await fetch(fileUrl, { credentials: 'same-origin' });
  if (!resp.ok) return null;
  return new Blob([await resp.blob()], { type: mime });
}
```

A file that is really SVG but named `.pdf` is then handed to the PDF viewer as PDF and does not execute. The same rule covers previews that put the **file URL** straight into an iframe: keep an allow-list (Office through the WOPI frame, PDF, plain text, raster images) and offer "Open in a new tab" for the rest, so SharePoint's download headers stay in charge.

## Verify

Upload a test SVG whose script only writes a marker, for example `<script>parent.__probe = 1</script>`, run your preview or print path against it, and read `window.__probe`. Then send the file to the recycle bin (`/_api/web/GetFileByServerRelativePath(decodedurl='…')/recycle()`). Expect `undefined` with the fix and `1` without it — if you cannot make it `1` on the old code, the probe is not exercising the path you think it is.

## Related

- [`.html` in a library cannot be iframed](../lists/html-in-a-library-cannot-be-iframed.md) — the same `Content-Disposition: attachment` from the other side: it is why the direct URL is safe.
