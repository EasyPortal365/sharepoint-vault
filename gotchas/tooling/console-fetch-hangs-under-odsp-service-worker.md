---
title: Console scripts on SharePoint hang because the ODSP service worker stalls every fetch
short-title: Console fetch hangs under the ODSP service worker
summary: A SharePoint page is controlled by the `odspserviceworkerproxy.aspx` service worker; when it gets stuck, every `fetch` from the page (even to another domain) never resolves while timers still run – a hard reload (Shift+F5) loads the page outside the worker and the script works
tags: [tooling, browser, service-worker, rest, devtools]
applies-to: SharePoint Online (modern pages and REST URLs in Chrome / Edge)
last-reviewed: 2026-11-09
---

# Console scripts on SharePoint hang because the ODSP service worker stalls every fetch

> **Bottom line.** If a script you paste into the browser console on `*.sharepoint.com` (or run through browser automation) never finishes, check whether only the network is stuck: timers fire, but no `fetch` resolves – not even one to another domain. SharePoint pages are controlled by its service worker (`odspserviceworkerproxy.aspx`), which intercepts every request of the page; when it hangs, so does your script. **Shift+F5** reloads the page without the service worker and the script runs.
>
> **Ve zkratce.** Když skript vložený do konzole na `*.sharepoint.com` nikdy nedoběhne, ověř, jestli stojí jen síť: časovače běží, ale žádný `fetch` se nedokončí – ani na jinou doménu. Stránky SharePointu řídí jeho service worker (`odspserviceworkerproxy.aspx`), který zachytává všechny požadavky stránky; když se zasekne, visí i tvůj skript. **Shift+F5** načte stránku bez service workeru a skript projde.

## Symptom

- A REST script (`await fetch('/_api/...')`) pasted into DevTools or run by an automation tool times out.
- It happens in a brand-new tab too, even on a bare REST URL such as `/_api/web/title`.
- The same browser runs scripts fine on any non-SharePoint page.
- CPU usage of the browser is flat – nothing is looping.

It is tempting to blame a frozen tab or a pending `alert()` dialog in another SharePoint tab (all `*.sharepoint.com` tabs usually share one renderer process). Those do block scripts, but they block **everything**, including timers.

## Diagnose in ten seconds

```js
window.__t = 'pending';
fetch('https://example.com/', { mode: 'no-cors', cache: 'no-store' })
  .then(() => window.__t = 'fetch ok', e => window.__t = 'fetch error ' + e);
setTimeout(() => window.__t2 = 'timer ok', 100);
const c = navigator.serviceWorker && navigator.serviceWorker.controller;
c ? 'controlled by ' + c.scriptURL.split('?')[0].split('/').pop() : 'no controller';
```

Read `[window.__t, window.__t2]` a moment later. `timer ok` together with `pending` on a page controlled by `odspserviceworkerproxy.aspx` = the service worker is the bottleneck.

## Fix

1. **Hard reload** the tab (`Shift+F5` / `Ctrl+Shift+R`). A hard reload bypasses the service worker for that page load, so `navigator.serviceWorker.controller` becomes `null`.
2. Run the script again – requests now go straight to the network.

The page stays uncontrolled until its next normal navigation, so run admin scripts right after the hard reload. A plain REST URL (`/_api/web/title`) is a good host page for console scripts: it loads fast and runs no page code of its own.

## Notes

- The worker intercepts **cross-origin** requests from the page as well, which is why even a call to your own CDN hangs.
- Closing other SharePoint tabs is usually not needed.
