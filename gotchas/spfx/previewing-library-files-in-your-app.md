---
title: "Previewing library files in your own app: every format behaves differently"
short-title: Previewing library files in your own app
summary: PDF embeds directly, Office needs WOPI by `{UniqueId}`, HTML is served as an attachment and never renders from `src`; SVG and HTML must never be framed from your own origin (uploader script runs in the viewer session) and OneDrive refuses framing with no way to detect it
tags: [spfx, sharepoint, files, preview, iframe, xss, svg]
applies-to: SharePoint Online (SPFx web parts, document libraries)
last-reviewed: 2026-09-21
---

# Previewing library files in your own app: every format behaves differently

> **Bottom line.** There is no single way to show a library file inside your app. PDFs embed straight from their URL, Office files need the WOPI frame keyed by **UniqueId**, and HTML cannot be embedded by URL at all — SharePoint serves it as an attachment, so the iframe stays blank with a clean console.
>
> **Ve zkratce.** Neexistuje jeden způsob, jak zobrazit soubor z knihovny uvnitř appky. PDF se vloží přímo z URL, Office potřebuje WOPI frame klíčovaný přes **UniqueId** a HTML přes URL vložit nejde vůbec – SharePoint ho posílá jako attachment, takže iframe zůstane prázdný a konzole čistá.
>
> **And two that bite later.** **SVG is not an image for this purpose** — it renders from a plain URL *and* can carry script, so framing it from your own tenant origin runs an uploader-controlled script in the viewer's session. **Files in OneDrive (`<tenant>-my.sharepoint.com`) refuse framing altogether** and leave a blank panel with nothing to catch.
>
> **A dvě, které koušou později.** **SVG pro tenhle účel není obrázek** — z prosté URL se vykreslí *a* může nést skript, takže jeho vložením z vlastního tenanta spustíte skript nahrávajícího v session prohlížejícího. **Soubory v OneDrivu (`<tenant>-my.sharepoint.com`) vkládání odmítají úplně** a nechají prázdný panel, na kterém není co zachytit.

## Symptom

You add a file preview dialog to your web part. Then:

- **PDF** opens what looks like a *folder listing* instead of the document.
- **HTML** shows an empty white frame. No error, no console message, nothing in the network tab that looks wrong — the request returns `200`.
- Images work fine, so the code "obviously" works.

## Cause

Three separate behaviours that are easy to conflate:

1. **`Doc.aspx` only handles Office formats.** Point it at a PDF and it falls back to rendering the library. Worse, if you pass a *file URL* as `sourcedoc` instead of the file's `{UniqueId}` GUID, it silently resolves to the containing library rather than erroring.
2. **PDFs need no viewer at all.** SharePoint serves them as `application/pdf` with **no** `Content-Disposition`, so the browser's built-in viewer renders them from a plain `<iframe src>`.
3. **HTML from a document library is always sent as an attachment.** That is deliberate — it stops anyone hosting web pages on your tenant. A browser will not render an attachment inside an iframe, so `src` produces an empty frame with no error to diagnose.

## Diagnose in one request

Before guessing, read the headers. This answers all three questions at once:

```js
const r = await fetch(fileUrl, { credentials: 'include' });
console.log(r.status, r.headers.get('content-type'), r.headers.get('content-disposition'));
// PDF  → 200  application/pdf   null          → embed directly
// HTML → 200  text/html         attachment;…  → src will NOT work
```

## Fix — branch by format

```tsx
// SVG is NOT in this list — see "Two more, learned the hard way" below.
if (isImage) return <img src={fileUrl} alt={name} />;

// PDF: direct — no WOPI, no Doc.aspx
if (isPdf) return <iframe title={name} src={fileUrl} />;

// Office: WOPI frame keyed by the file's UniqueId (a GUID), not its URL
if (isOffice) {
  const url = `${webUrl}/_layouts/15/WopiFrame.aspx?sourcedoc=%7B${uniqueId}%7D&action=embedview`;
  return <iframe title={name} src={url} />;
}

// HTML: fetch the markup yourself and inject it — this bypasses the attachment header.
// sandbox="" (no allow-scripts): styles render, foreign JS does not execute.
if (isHtml) return <iframe title={name} srcDoc={html} sandbox="" />;

return <DownloadFallback />;   // anything else: be honest, offer the download
```

Notes that save a second round of debugging:

- **`Doc.aspx` / `WopiFrame.aspx` are web-scoped.** Build the URL from the *file's* web, not from the tenant root — otherwise you get "Item does not exist" for a file that plainly exists.
- **Fetching the HTML yourself is a privilege boundary decision.** You are injecting content an editor uploaded into your authenticated page. Keep `sandbox=""` so styles work but scripts never run; do not "temporarily" add `allow-scripts` to make some flyer's animation work.
- **Always keep a download and an open-in-SharePoint action** in the dialog header. Preview is a convenience; the file itself must stay reachable when the preview cannot render it.

## Two more, learned the hard way

### SVG renders — which is exactly the problem

`.svg` looks like an image, so it lands in the image branch and gets framed straight from its URL.
That URL is on **your tenant's origin**, the same origin as the web part. An SVG can carry
`<script>`, so anyone who can contribute to *any* library in your preview's reach can upload
`price-list.svg`, wait for search to index it and for someone to click preview, and have their
script run in that person's session under their identity. The same applies to `.html` if you
"fixed" the blank frame by fetching the markup and injecting it without `sandbox`.

`sandbox` does not rescue the image branch: without `allow-same-origin` the request loses its
cookies, so Office embeds and ordinary images stop loading too. Keep `sandbox=""` for the
fetch-and-inject HTML path only.

**Fix:** exclude `svg`, `html` and `htm` from framing entirely and offer "Open in a new tab"
instead — the same escape hatch you already need for OneDrive. `.aspx` can stay: modern SharePoint
pages have their own pipeline, and a script uploaded as a file will not execute there.

```tsx
const SCRIPTABLE = ['svg', 'html', 'htm'];      // never frame these from your own origin
if (SCRIPTABLE.indexOf(ext) !== -1) return <OpenInNewTabOnly url={fileUrl} />;
```

### OneDrive refuses to be framed, and the iframe cannot tell you

Files under `<tenant>-my.sharepoint.com` ship stricter `X-Frame-Options`/CSP than team sites, so
the preview ends as a **blank panel** — no error, no console message. You cannot measure it either:
the frame is a foreign origin, so `onLoad` fires the same way whether it rendered or refused.

**Fix:** decide up front, from the host name, and show an explanation plus an "Open online" button
instead of an empty box.

```ts
const isOneDrive = /-my\.sharepoint\.com$/i.test(new URL(fileUrl).host);
```

Same shape as the scriptable types: when you know framing will not work, say so — a blank panel
reads as "your app is broken", not as "this file cannot be shown here".

## Meta-lesson

Two of these three behaviours were already written down in our internal notes — and the code still shipped with `Doc.aspx` pointed at a PDF, because nobody thought to look under "REST writes" for something framed as "add a file preview". If your knowledge base is indexed by *API*, add symptom-shaped keywords (*preview, show PDF, iframe, blank frame*) so the note is findable from the task, not just from the API name.
