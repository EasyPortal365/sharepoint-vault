---
title: The tenant's CSP is inherited by `srcdoc` frames — inline scripts in embedded HTML never run
tags: [spfx, csp, iframe, security, embedding]
applies-to: SharePoint Online modern pages (SPFx web parts that embed HTML they fetched themselves)
last-reviewed: 2026-09-08
---

# The tenant's CSP is inherited by `srcdoc` frames — inline scripts in embedded HTML never run

> **Bottom line.** SharePoint Online sends a `Content-Security-Policy: script-src 'self' 'unsafe-eval' <allow-listed hosts…>` header on modern pages — with **no `'unsafe-inline'`**. A document you build yourself inside that page (`<iframe srcdoc>`, `blob:` or `data:` URL) has a *local scheme* and therefore **inherits that policy**: every inline `<script>` and every `onclick="…"` in the embedded HTML is silently dropped, and the page shows as static markup. External scripts are fine as long as they come from an allow-listed source — and `'self'` includes a `.js` file in a document library of the same site, which SharePoint serves as `application/javascript` without a download disposition. A cross-origin `<iframe src="https://…">` is not affected at all: the framed document lives under its own server's policy.
>
> **Ve zkratce.** SharePoint Online posílá na moderních stránkách hlavičku `Content-Security-Policy: script-src 'self' 'unsafe-eval' <povolené hosty…>` — **bez `'unsafe-inline'`**. Dokument, který si na takové stránce sami vyrobíte (`<iframe srcdoc>`, `blob:` nebo `data:` adresa), má *lokální schéma*, a proto **tu politiku dědí**: každý inline `<script>` i každý `onclick="…"` ve vloženém HTML se tiše zahodí a stránka se ukáže jako statické značky. Externí skripty projdou, pokud jdou z povoleného zdroje — a `'self'` zahrnuje i `.js` soubor v knihovně téhož webu, který SharePoint servíruje jako `application/javascript` bez nabídky ke stažení. Cizí `<iframe src="https://…">` politika vůbec nezasáhne: rámovaný dokument žije pod politikou svého serveru.

## Symptom

A web part reads an HTML file from a site library through REST (`GetFileByServerRelativePath(...)/$value`) and renders it in `<iframe sandbox="allow-scripts" srcdoc="…">`. Opened on its own in a browser tab the file works. Inside the SharePoint page it comes up as a skeleton: template placeholders left unreplaced, an empty canvas, buttons that do nothing — and **no error in the web part's console**. The frame's own console (visible only in DevTools when you select the frame context) reports:

```
Refused to execute inline script because it violates the following Content Security Policy directive: "script-src 'self' 'unsafe-eval' https://…"
```

## Cause

Read the page's response headers on the page itself:

```js
const r = await fetch(location.href.split('?')[0], { cache: 'no-store' });
r.headers.get('content-security-policy');
// → "script-src 'self' 'unsafe-eval' https://cdn.example.com/app/ …; worker-src blob: 'self'; report-to cspendpoint"
```

The policy comes from the tenant (SharePoint admin center → script allow-list); the modern page framework relies on `'unsafe-eval'`, but nothing grants `'unsafe-inline'`. CSP Level 3 says documents with a *local scheme* (`about:srcdoc`, `blob:`, `data:`) inherit the policy of the document that created them. `sandbox` does not interact with this: sandboxing limits what the document may *do*, CSP decides where its scripts may *come from*.

Measured on one tenant, from inside a `sandbox="allow-scripts"` `srcdoc` frame on a modern page:

| Script source | Result |
|---|---|
| inline `<script>` | blocked |
| inline `onclick="…"` | blocked |
| `<script src="https://<tenant>.sharepoint.com/sites/x/SiteAssets/app/engine.js">` | **runs** — `'self'` is the parent's origin, kept on the inherited policy |
| `<script src="/sites/x/SiteAssets/app/engine.js">` (relative) | **runs** — the srcdoc document resolves relative URLs against the parent's base URL |
| `new Function(...)` inside the running script | works — `'unsafe-eval'` is part of the tenant policy |
| cross-origin `<iframe src="https://cdn…/page.html">` | its own inline scripts run — the parent's CSP has no `frame-src`, and the framed document is not local-scheme |

A `.js` file in a document library is served with `Content-Type: application/javascript`, `X-Content-Type-Options: nosniff` and **no** `Content-Disposition`, so it is a valid script source. `.html` files in the same library are served *as downloads* — that is why the HTML has to go through REST + `srcdoc` in the first place.

## Fix

1. **Keep the HTML in the library, move the code out of it.** The embedded document may contain only markup and CSS (there is no `style-src`, so inline styles are fine); everything executable lives in a `.js` file next to it, referenced with an absolute same-origin URL. Data can stay in the HTML as `<script type="application/json">` — it is not executed, so CSP ignores it.
2. **Inline handlers in generated markup**: either switch to delegated listeners with `data-*` attributes, or hydrate them after render — read the `on*` attribute, remove it, and attach `new Function('event', code)` as a listener. The second option depends on `'unsafe-eval'`, which SharePoint Online ships by default; say so in the code.
3. **Or embed by URL.** If the content may live on a host of its own (your CDN, a static site), point `<iframe src>` at it: the framed document gets that host's policy, not the tenant's. Mind what that host makes public.
4. **Tell the administrator in the UI.** "The page rendered" and "the page rendered without its scripts" look identical from outside the frame; a feature that embeds admin-supplied HTML has to state the limitation in its help text.

## Do not

- Do not expect `<iframe src="…/SiteAssets/page.html">` to be the way out. SharePoint serves `.html` stored in a library **as a download** (`Content-Disposition: attachment`), so the frame stays blank — that is why the content goes through REST and `srcdoc` in the first place, and why the script has to be a separate `.js` file (served as `application/javascript`) rather than markup.
- Do not test only outside SharePoint. A file that works from `file://` or `localhost` proves nothing about the frame inside a modern page — the policy that breaks it exists only there.
- Do not reach for `blob:` or `data:` URLs as a workaround; they are local-scheme documents and inherit the policy exactly like `srcdoc`.
- Do not ask customers to add `'unsafe-inline'` to their tenant policy. It disables the protection for every page in the tenant to make one embedded page work.
