---
title: "An `.html` file in a document library cannot be iframed — SharePoint serves it as a download"
tags: [lists, libraries, modern-pages, embed, iframe, content-disposition, hosting]
applies-to: SharePoint Online (all site templates); modern pages and the Embed web part
last-reviewed: 2026-09-10
---

# An `.html` file in a document library cannot be iframed — SharePoint serves it as a download

> **Bottom line.** SharePoint Online sends `.html` from a document library with `Content-Disposition: attachment`, so an `<iframe>` pointed at it fires `onload` with an empty document instead of rendering your page — and there is no per-site "browser file handling" switch to change that. To put a self-contained HTML page inside a modern page you must host it on some other HTTPS origin **and** add that host to the site's HTML Field Security list, which the Embed web part enforces.
>
> **Ve zkratce.** SharePoint Online posílá `.html` z knihovny s hlavičkou `Content-Disposition: attachment`, takže `<iframe>` mířící na soubor vyvolá `onload` s prázdným dokumentem místo vaší stránky – a přepínač „browser file handling" v SharePointu Online neexistuje. Pokud chcete samostatnou HTML stránku uvnitř moderní stránky, musíte ji hostovat na jiném HTTPS původu **a** ten původ doplnit do seznamu HTML Field Security, který web part Vložit vynucuje.

## Symptom

You have one self-contained `.html` file — a prototype, a report, a small tool — and you want it inside a modern page. The obvious plan: upload it to `SiteAssets`, add an Embed web part, point an iframe at it. Instead:

- the iframe's `onload` fires, but `contentDocument.body.innerText` is empty;
- or the browser starts downloading the file when you open the URL directly;
- and the Embed web part may refuse the code outright with a message about the domain not being allowed.

The upload itself succeeds and `GET` on the file returns `200 text/html`, which makes the failure look like a rendering problem in your own markup.

## Cause

Two separate gates, and only the first one is obvious once you look at the headers.

**1. The library forces a download.** SharePoint Online serves HTML from document libraries with `Content-Disposition: attachment` (alongside `X-Download-Options: noopen`). This is deliberate anti-XSS behaviour: library content is user-supplied, and rendering it inline on the tenant's own origin would let any contributor run script as any reader. On-premises had a per-web-application *browser file handling* setting; **SharePoint Online does not expose it**, so this is not configurable.

Note that `Content-Type` is still `text/html`. Checking only the content type tells you nothing:

```js
const r = await fetch('/sites/<site>/SiteAssets/probe.html');
r.headers.get('content-type');                                  // 'text/html' — looks fine
(r.headers.get('content-disposition') || '').includes('attachment');  // true — this is the answer
```

A quicker, header-free probe that matches what the page will actually do:

```js
// onload + an empty body == the browser downloaded it instead of rendering it
const f = document.createElement('iframe');
f.style.cssText = 'position:fixed;left:-9999px';
f.onload = () => console.log('rendered text:', f.contentDocument?.body?.innerText.trim() || '(nothing)');
document.body.appendChild(f);
f.src = '/sites/<site>/SiteAssets/probe.html';
```

Renaming the file to `.aspx` does not help either: ASPX uploaded into a library is not executed, and on sites where custom script is disabled (the default for years now) the upload is blocked outright.

**2. The Embed web part only trusts an allow-list.** Even with a working external host, the modern Embed web part checks the **site collection's** HTML Field Security setting at `/_layouts/15/htmlfieldsecurity.aspx`. The default is *"Allow contributors to insert iframes only from the following domains"* with a fixed list of roughly forty Microsoft and partner domains (youtube.com, player.vimeo.com, powerbi.com, sway.com, forms.office.com …). Your own host is not on it.

## Fix

**Host the page on a different HTTPS origin, then allow that origin on the site.**

1. Put the file anywhere that serves `text/html` inline — a static-site host, a storage account with static website hosting, an Azure Function, your own CDN. A single self-contained file (inline CSS and JS, no external requests) keeps this to one artefact.
2. Open `https://<tenant>.sharepoint.com/sites/<site>/_layouts/15/htmlfieldsecurity.aspx`, keep the *"only from the following domains"* mode, type the bare host name (no scheme, no path) into the box, **Add**, then **OK**. Prefer this over switching the site to *"any domain"* — the narrow change is auditable and reversible.
3. Add the Embed web part to the page and paste a plain iframe:

```html
<iframe src="https://your-host.example/app/" width="100%" height="1100"
        frameborder="0" style="border:0;display:block" title="…"></iframe>
```

**Make the hosted page adapt to being framed.** The same file can serve as a standalone document and as an embedded app if it detects the frame itself:

```js
let framed = false;
try { framed = window.self !== window.top; } catch (e) { framed = true; }   // cross-origin throws → framed
if (framed || /[?&]app=1/.test(location.search)) {
  document.documentElement.classList.add('embedded');   // hide your own top chrome, fill the frame
}
```

Pair that with a CSS block that gives the embedded variant `height: 100vh` and a single internal scroll container, so the viewer does not get one scrollbar from the host page and another from your iframe.

**Two things to watch when you do this:**

- **Scope the CSS you add for the embedded variant.** A rule as broad as `.embedded .main { height: 100vh }` will also match an unrelated element that happens to carry `main` among its classes — a button labelled `class="btn main"` became 989 px tall this way. Scope to the structure you mean (`.embedded .shell > .main`).
- **The host is public unless you make it otherwise.** A static-site host has no sign-in. If the content is not meant for the open internet, put it behind a key or a gateway before you paste the iframe.

## Why this is worth a page of its own

The first gate looks like your problem and the second looks like a bug. A `200` with `Content-Type: text/html` invites you to debug your own markup for an hour, and an iframe that reports a successful `onload` while showing nothing is the least informative failure a browser produces. Knowing that libraries never render HTML inline — and that the Embed web part has a separate, site-level allow-list — turns the whole exercise into two known steps.
