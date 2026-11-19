---
title: Office add-in with NAA times out in Office on the web — MSAL 5 needs the redirect bridge
short-title: Office add-in NAA times out on the web (MSAL 5)
summary: "`ssoSilent` → `timed_out` only in Word/Excel/PowerPoint on the web; the redirect page must call `broadcastResponseToMainFrame()`"
tags: [graph, office-add-ins, naa, msal, entra-id, authentication]
applies-to: Office add-ins (Word, Excel, PowerPoint task panes), MSAL Browser 5.x, nested app authentication
last-reviewed: 2026-11-19
---

# Office add-in with NAA times out in Office on the web

> **Bottom line.** In an Office add-in that signs in with `createNestablePublicClientApplication` (nested app authentication), Word, Excel and PowerPoint **on the web** can end `ssoSilent` with `timed_out`. On the web these hosts use the normal browser flow: a hidden iframe or popup loads your `redirectUri`. MSAL Browser 5 no longer reads that response by itself. The redirect page has to post it back with `broadcastResponseToMainFrame()` from `@azure/msal-browser/redirect-bridge`.
>
> **Ve zkratce.** Doplněk Office s přihlášením přes `createNestablePublicClientApplication` (NAA) může ve Wordu, Excelu a PowerPointu **na webu** skončit u `ssoSilent` chybou `timed_out`. Na webu tyto aplikace používají běžný tok prohlížeče, tedy skrytý iframe nebo popup na `redirectUri`. MSAL Browser 5 odpověď sám nepřečte, takže stránka přesměrování ji musí poslat zpět voláním `broadcastResponseToMainFrame()` z `@azure/msal-browser/redirect-bridge`.

## Symptom

- Office on the web (document opened from SharePoint Online): `ssoSilent` throws `BrowserAuthError: timed_out`.
- The app registration and CORS look correct. A SPA redirect to `brk-multihub://<your-origin>` is registered, and the token endpoint answers.

## Cause

Microsoft's NAA guide states that Word, Excel and PowerPoint on the web use a standard browser authentication flow, which is why the task pane page needs its own SPA redirect URI. That flow loads `redirectUri` in a hidden iframe or popup. Since MSAL Browser 5, the page at `redirectUri` must hand the auth response to the main frame explicitly. If that page is your task pane and it just boots the app again, the response is never delivered, and the caller waits until it times out.

## Fix

1. Register **both** SPA redirect URIs on the app registration:
   - `brk-multihub://<your-origin>` for desktop NAA;
   - the full URL of the task pane page, for the web flow.
2. At the very top of the task pane script, detect an auth response and bridge it **before** initializing Office.js or MSAL:

```js
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

const isAuthResponse = /[#&?](state|code|error)=/.test(location.hash) &&
  /state=/.test(location.hash + location.search);

if (isAuthResponse) {
  broadcastResponseToMainFrame().catch(() => undefined);
} else {
  Office.onReady(() => startApp());
}
```

3. Pass a `loginHint` to `ssoSilent`, taken from `Office.auth.getAuthContext()`.

After this change, tokens on the web were issued silently in about 1–3 s in all three hosts, and then from cache in milliseconds.

## Related trap: cached task pane code

A CDN that serves the task pane page and script with `Cache-Control: max-age=…` keeps old code in the pane after you redeploy. Chrome partitions its HTTP cache by top-level site, so the iframe copy (under the Office/SharePoint origin) is separate from the copy you open directly. Reloading the document page may not refresh it. Keep the pane page stable and small, and load the code with a version in the URL.

## Related trap: a CSP on the task pane page blocks the silent flow

If the task pane page sends a Content-Security-Policy with `frame-src https://login.microsoftonline.com` only, silent sign-in on the web fails again. The hidden iframe starts at the sign-in page and then redirects to `redirectUri`, which is the task pane page on your own origin. Browsers check CSP again on each redirect of a request, so `frame-src` also applies to that redirect target. The browser blocks the frame and no token arrives. Allow your own origin too: `frame-src 'self' https://login.microsoftonline.com`. In our pilot this one change made silent sign-in work again. Put the error code into the message the pane shows, because the iframe console is hard to reach in Office on the web.

## Related trap: sideloading on the web is per app

An add-in uploaded in Word on the web does not appear in Excel or PowerPoint on the web, even if the manifest lists all three hosts. Upload it in each app via **Home → Add-ins → Advanced… → MY ADD-INS → Upload My Add-in**. The newer "Apps" store dialog has no upload option.

## Sources

- [Enable SSO in an Office Add-in with nested app authentication](https://learn.microsoft.com/office/dev/add-ins/develop/enable-nested-app-authentication-in-your-add-in) – `brk-multihub` redirect and the extra task pane redirect for Word, Excel and PowerPoint on the web.
- [Migrate from MSAL Browser v4 to v5](https://learn.microsoft.com/entra/msal/javascript/browser/v4-migration) – all flows use the redirect bridge; popup and silent responses go through `broadcastResponseToMainFrame()`.
- [Set up the redirect bridge page](https://learn.microsoft.com/entra/msal/javascript/browser/redirect-bridge) – the bridge page must not be served with COOP headers.
- [CSP: frame-src (MDN)](https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src) – valid sources for nested browsing contexts such as iframes.
- [Fetch Standard: HTTP-redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch) – a redirect runs main fetch again, including the CSP check.
- [Nested app auth requirement set](https://learn.microsoft.com/javascript/api/requirement-sets/common/nested-app-auth-requirement-sets) – on the web, NAA is supported only for documents opened from SharePoint Online and OneDrive.
