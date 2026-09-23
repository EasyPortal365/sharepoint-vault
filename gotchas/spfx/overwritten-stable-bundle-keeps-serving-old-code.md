---
title: An overwritten script with a stable name keeps serving the old code
tags: [spfx, cdn, caching, github-pages, service-worker, deployment]
applies-to: SPFx components (or any page) loading a script from a static host under a fixed, unhashed name
last-reviewed: 2026-09-24
---

# An overwritten script with a stable name keeps serving the old code

> **Bottom line.** A file that keeps its name across releases — a loader, a shell, an `app.js` — is cached by that name. GitHub Pages sends `Cache-Control: max-age=600`, the browser's memory cache keeps the old copy across in-page navigation (in our tests even into a new tab of the same site), and on modern SharePoint pages a service worker sits in front as well — so "published and refreshed" proves nothing. Keep stable files thin and rarely changed, put everything that changes behind versioned or content-hashed URLs, and test a new stable file after `fetch(url, { cache: 'reload' })` with every tab of the site closed.
>
> **Ve zkratce.** Soubor, který si mezi vydáními drží jméno – loader, shell, `app.js` –, se cachuje právě podle toho jména. GitHub Pages posílá `Cache-Control: max-age=600`, paměťová cache prohlížeče drží starou kopii přes navigaci uvnitř stránky (v našich testech i do nového tabu téhož webu) a na moderních stránkách SharePointu před tím vším stojí ještě service worker – takže „nahráno a obnoveno“ nic nedokazuje. Stabilní soubory drž tenké a měň je zřídka, všechno, co se mění, dej za verzované nebo obsahově hashované adresy a nový stabilní soubor testuj po `fetch(url, { cache: 'reload' })` se všemi taby webu zavřenými.

## Symptom

You overwrite `tools-shell.js` on the CDN. The page, reloaded, keeps running the old code, and a new tab of the same site may too. Later the new version shows up on its own — or sooner, once every tab of the site has been closed.

## Cause

Several caches answer before the network does:

1. **The HTTP cache.** GitHub Pages serves its files with `Cache-Control: max-age=600`, so for ten minutes the browser may reuse its copy without asking.
2. **The renderer's memory cache.** It survives in-page (SPA) navigation, and in our tests same-site tabs of the same browser process shared it — which is why a new tab is not a clean test.
3. **SharePoint's service worker.** Modern pages register one ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/454435/sharepoint-online-service-worker-functionality)), and an open report describes the SPFx service worker serving stale script bundles from external hosts regardless of `Cache-Control` ([sp-dev-docs #10013](https://github.com/SharePoint/sp-dev-docs/issues/10013)).
4. **Anything in between** that caches by URL.

A versioned or content-hashed URL sidesteps all of them: a new release is a URL nobody has cached yet.

## Fix

- **Keep the stable file thin.** Let it do as little as possible, load everything that changes from versioned or hashed URLs, and change the stable file only when there is no other way.
- **Test a new stable file deliberately:** `await fetch(url, { cache: 'reload' })` refreshes the HTTP cache entry; then close *all* tabs of the site before reloading.
- **Check where the script came from** in DevTools → Network: the Size column names the cache — memory, disk or service worker — instead of a transfer size. Don't lean on `performance.getEntriesByType('resource')` here: `transferSize` is `0` for a cache hit, but also for **every** cross-origin resource served without a `Timing-Allow-Origin` header, and GitHub Pages does not send one.

## Notes

- For your users this is propagation measured in minutes to tens of minutes, not a bug. For the development loop it is the difference between "my fix works" and "my fix never loaded".
- Related: [Polling the manifest proves nothing](static-host-serves-manifest-before-bundle.md) · [PerformanceResourceTiming: transferSize (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/transferSize)
