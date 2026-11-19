---
title: Office add-in with NAA times out in Office on the web — MSAL 5 needs the redirect bridge
short-title: Office add-in NAA times out on the web (MSAL 5)
summary: "`ssoSilent` → `timed_out` only in Word/Excel/PowerPoint on the web; the redirect page must call `broadcastResponseToMainFrame()`"
tags: [graph, office-add-ins, naa, msal, entra-id, authentication]
applies-to: Office add-ins (Word, Excel, PowerPoint task panes), MSAL Browser 5.x, nested app authentication
last-reviewed: 2026-11-19
---

# Office add-in with NAA times out in Office on the web

> **Bottom line.** In an Office add-in that signs in with `createNestablePublicClientApplication` (nested app authentication), tokens arrive instantly on desktop, but in Word, Excel and PowerPoint **on the web** `ssoSilent` ends with `timed_out` after about 10 seconds. On the web these hosts use the normal browser flow: a hidden iframe or popup loads your `redirectUri`. MSAL Browser 5 no longer reads that response by itself. The redirect page has to post it back with `broadcastResponseToMainFrame()` from `@azure/msal-browser/redirect-bridge`.
>
> **Ve zkratce.** Doplněk Office s přihlášením přes `createNestablePublicClientApplication` (NAA) dostane token na desktopu hned. Ve Wordu, Excelu a PowerPointu **na webu** ale `ssoSilent` po ~10 s skončí `timed_out`. Na webu tyto aplikace používají běžný tok prohlížeče, tedy skrytý iframe nebo popup na `redirectUri`. MSAL Browser 5 odpověď sám nepřečte, takže stránka přesměrování ji musí poslat zpět voláním `broadcastResponseToMainFrame()` z `@azure/msal-browser/redirect-bridge`.

## Symptom

- Desktop Office: `acquireTokenSilent` / `ssoSilent` succeeds in milliseconds through the NAA broker.
- Office on the web: `ssoSilent` throws `BrowserAuthError: timed_out`, and a fallback `acquireTokenPopup` opens a window that never closes.
- The app registration and CORS look correct. A SPA redirect to `brk-multihub://<your-origin>` is registered, and the token endpoint answers.

## Cause

Office on the web doesn't broker tokens for these hosts the way desktop does, so MSAL falls back to the standard iframe or popup flow against `redirectUri`. Since MSAL Browser 5, the page at `redirectUri` must hand the auth response to the main frame explicitly. If that page is your task pane and it just boots the app again, the response is never delivered, and the caller waits until it times out.

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

A CDN that serves the task pane page and script with `Cache-Control: max-age=…` keeps old code in the pane after you redeploy. Chrome partitions its HTTP cache by top-level site, so the iframe copy (under the Office/SharePoint origin) is separate from the copy you open directly. A hard reload of the document page doesn't refresh it. Keep the pane page stable and small, and load the code with a version in the URL.

## Related trap: sideloading on the web is per app

An add-in uploaded in Word on the web does not appear in Excel or PowerPoint on the web, even if the manifest lists all three hosts. Upload it in each app via **Home → Add-ins → Advanced… → MY ADD-INS → Upload My Add-in**. The newer "Apps" store dialog has no upload option.
