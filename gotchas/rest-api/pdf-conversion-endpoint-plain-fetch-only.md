---
title: SharePoint's built-in PDF conversion endpoint works only with a plain fetch — auth headers break the redirect
tags: [rest-api, files, pdf, spfx, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-17
---

# SharePoint's built-in PDF conversion endpoint works only with a plain fetch — auth headers break the redirect

> **Bottom line.** SharePoint Online can convert Office files to PDF server-side, no Graph consent needed: `GET <web>/_api/v2.0/drives/<driveId>/root:/<path>:/content?format=pdf`. But you must call it with a **plain `fetch(url, { credentials: 'same-origin' })`** — the endpoint answers with a 302 to a pre-authenticated `*.svc.ms` URL, and clients that attach extra auth headers (SPFx `SPHttpClient`, request-digest wrappers) or send cookies cross-origin break the hop. Resolve the drive explicitly and guard on `Content-Type` before using the result.
>
> **Ve zkratce.** SharePoint Online umí sám převést Office soubory do PDF: `GET <web>/_api/v2.0/drives/<driveId>/root:/<cesta>:/content?format=pdf` – bez Graphu a bez consentů. Volat ale VÝHRADNĚ prostým `fetch(url, { credentials: 'same-origin' })` – endpoint odpovídá 302 na předautentizovanou `*.svc.ms` adresu a klienti přidávající auth hlavičky (SPFx `SPHttpClient`, digest wrappery) ten přeskok rozbijí. Drive resolvuj explicitně a výsledek pusť dál jen po kontrole `Content-Type`.

## What works

SharePoint Online exposes a same-origin flavour of the Graph drive API on every web. The `format=pdf` transform converts `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `rtf` (and a few more) without any Azure AD app, admin consent, or external service:

```
GET https://tenant.sharepoint.com/sites/hr/_api/v2.0/drives/<driveId>/root:/Policies/Safety.docx:/content?format=pdf
```

The path after `root:` is **relative to the drive (library) root**, URL-encoded per segment. The response is a 302 redirect to a short-lived, token-authenticated download URL on `*.svc.ms`, which then streams the PDF.

## The traps

1. **Do not use an authenticated client.** The first request is same-origin and cookie-authenticated. The redirect target is **cross-origin** and authenticated by a token in the URL — cookies and `Authorization`/digest headers must *not* travel there. A plain browser `fetch` with `credentials: 'same-origin'` handles the pair correctly (cookies on hop 1, none on hop 2). SPFx `SPHttpClient` and similar wrappers decorate every request and the conversion fails or dead-ends.

2. **Resolve the drive, don't guess it.** Each document library is its own drive. List them and match by path, otherwise a non-default library converts the wrong file (or 404s):

   ```js
   const r = await fetch(webUrl + '/_api/v2.0/drives', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
   const drives = (await r.json()).value;
   const target = '/sites/hr/PolicyLibrary'; // server-relative library path, lowercased
   const drive = drives.find(d => decodeURIComponent(new URL(d.webUrl).pathname).toLowerCase().replace(/\/$/, '') === target);
   ```

3. **Guard on `Content-Type`.** An expired session answers with a login **HTML page and HTTP 200**. If you pipe the body straight into a viewer, an `<iframe>` for printing, or a file download, the user gets a saved login page instead of their document. Accept only `application/pdf` (or `application/octet-stream`); treat `text/html` as failure.

4. **PDFs and images don't need the transform.** Fetch them directly (same `Content-Type` guard applies). Sending a PDF through `format=pdf` is pointless and can error.

## Why not Graph?

`GET https://graph.microsoft.com/v1.0/drives/<id>/items/<id>/content?format=pdf` does the same conversion — but from a web client it needs an Azure AD app with `Files.Read.All` and admin consent. The `_api/v2.0` flavour rides the user's existing SharePoint session: zero setup, and the conversion never leaves the tenant boundary you are already in.

## Verified

Battle-tested in a production browser extension and an SPFx ListView Command Set (2026): print-and-save-as-PDF actions over document libraries, including non-default libraries and files with spaces/diacritics in their paths.
