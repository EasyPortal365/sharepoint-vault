---
title: Office add-in pane stuck on its loading text — your CSP must allow the scripts office.js loads itself
short-title: Office add-in stuck loading (CSP blocks MicrosoftAjax.js)
summary: "Classic Outlook needs `ajax.aspnetcdn.com` (MicrosoftAjax.js) in `script-src`; Office.onReady never fires otherwise"
tags: [graph, office-add-ins, csp, outlook, webview2, cache]
applies-to: Office add-ins (task panes) with a Content-Security-Policy on the pane page; classic Outlook for Windows, Word/Excel/PowerPoint desktop (WebView2)
last-reviewed: 2026-11-26
---

# Office add-in pane stuck on its loading text

> **Bottom line.** If your task pane page sends a strict CSP such as `script-src 'self' https://appsforoffice.microsoft.com`, classic Outlook for Windows never gets past your loading text. office.js itself loads `//ajax.aspnetcdn.com/ajax/3.5/MicrosoftAjax.js` (and, for sign-in, `https://alcdn.msauth.net/browser-1p/…/msal-browser-1p.min.js`). The CSP blocks them, office.js throws, and `Office.onReady` never fires. Add both hosts to `script-src`. Also make your pane notice that it never rendered, because a page stuck on static text gives the user nothing to act on.
>
> **Ve zkratce.** Když stránka panelu posílá přísné CSP, třeba `script-src 'self' https://appsforoffice.microsoft.com`, klasický Outlook pro Windows nikdy nepřejde přes úvodní text. office.js si sám dotahuje `//ajax.aspnetcdn.com/ajax/3.5/MicrosoftAjax.js` a pro přihlášení `https://alcdn.msauth.net/browser-1p/…/msal-browser-1p.min.js`. CSP je zablokuje, office.js spadne a `Office.onReady` nepřijde. Oba hosty patří do `script-src`. A panel má sám poznat, že nic nevykreslil: stránka zaseklá na statickém textu uživateli nedá nic, s čím by mohl něco udělat.

## Symptom

- Classic Outlook for Windows: the pane shows only the static text of your HTML, forever. Word, Excel, PowerPoint and Outlook on the web work.
- Pane console (right-click in the pane → Inspect): a CSP violation for `https://ajax.aspnetcdn.com/ajax/3.5/MicrosoftAjax.js` from `outlook-win32-16.02.js`, then `Uncaught MicrosoftAjax.js is not loaded successfully` from `office.js`.

## Cause

The host-specific office.js files (`office.js`, `outlook-win32-16.02.js`, `outlook-web-16.01.js`, `outlook-mac-16.00.js`, `excel-win32-16.01.js`, `powerpoint-win32-16.01.js` on `https://appsforoffice.microsoft.com/lib/1/hosted/`) contain a script loader for MicrosoftAjax.js on `ajax.aspnetcdn.com` and a reference to MSAL 1p on `alcdn.msauth.net`. The Office add-in docs only tell you to reference office.js. They don't list these hosts for a CSP. You can confirm them yourself by downloading the files and searching for `aspnetcdn` and `msauth`.

## Fix

```text
script-src 'self' https://appsforoffice.microsoft.com https://ajax.aspnetcdn.com https://alcdn.msauth.net
```

Make the pane detect a hang:

- Count the pane as started only when it has **rendered** something, such as an element inside your root node or your own error bar. Loading your module or injecting your styles doesn't count: both can happen before `Office.onReady`, which may never come.
- Listen for `window` `error` events before your app renders. An error thrown inside office.js reaches your handler censored, as `"Script error."` with an empty `filename`, because it's a cross-origin script loaded without `crossorigin`.
- After a short timeout (around 10 s) with nothing rendered, replace the loading text with a message and a code the user can send to their admin.

## Related trap: corrupted WebView2 cache

If someone deletes `%LOCALAPPDATA%\Microsoft\Office\16.0\Wef\` while `msedgewebview2.exe` processes are still running, the WebView2 HTTP cache can end up corrupted. Long-cached files then fail with `net::ERR_CACHE_READ_FAILURE` and the pane hangs the same way. To protect against this:

- Serve the small bootstrap script with `Cache-Control: no-store`.
- If a module fails to load, retry once from a **different host** (a mirror). A `?r=` query string only bypasses the entry file, so the chunks it imports would come from the broken cache again. Modules from another origin need `Access-Control-Allow-Origin`. On an Azure Storage static website, Blob CORS rules don't apply to the web endpoint, so add the header with a Front Door rule.
- Never tell users to clear `Wef` to get a new version. A stable page URL with versioned code paths updates by itself. If `Wef` really has to go, close Office and end all `msedgewebview2.exe` processes first.
