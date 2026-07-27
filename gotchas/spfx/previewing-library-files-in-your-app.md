---
title: "Previewing library files in your own app: every format behaves differently"
tags: [spfx, sharepoint, files, preview, iframe]
applies-to: SharePoint Online (SPFx web parts, document libraries)
last-reviewed: 2026-07-27
---

# Previewing library files in your own app: every format behaves differently

> **Bottom line.** There is no single way to show a library file inside your app. PDFs embed straight from their URL, Office files need the WOPI frame keyed by **UniqueId**, and HTML cannot be embedded by URL at all — SharePoint serves it as an attachment, so the iframe stays blank with a clean console.
>
> **Ve zkratce.** Neexistuje jeden způsob, jak zobrazit soubor z knihovny uvnitř appky. PDF se vloží přímo z URL, Office potřebuje WOPI frame klíčovaný přes **UniqueId** a HTML přes URL vložit nejde vůbec — SharePoint ho posílá jako attachment, takže iframe zůstane prázdný a konzole čistá.

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

## Meta-lesson

Two of these three behaviours were already written down in our internal notes — and the code still shipped with `Doc.aspx` pointed at a PDF, because nobody thought to look under "REST writes" for something framed as "add a file preview". If your knowledge base is indexed by *API*, add symptom-shaped keywords (*preview, show PDF, iframe, blank frame*) so the note is findable from the task, not just from the API name.
