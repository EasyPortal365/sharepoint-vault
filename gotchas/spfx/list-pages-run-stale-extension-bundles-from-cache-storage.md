---
title: List and library pages run a stale extension bundle from Cache Storage for days
tags: [spfx, extensions, application-customizer, command-set, cdn, caching]
applies-to: SharePoint Online (modern list and library pages)
last-reviewed: 2026-09-24
---

# List and library pages run a stale extension bundle from Cache Storage for days

> **Bottom line.** If an SPFx extension loads a bundle whose URL never changes (no content hash – the usual trick to update a tenant-wide extension without a new `.sppkg`), modern **list and library pages** can keep executing an old copy for days. The Lists web app stores extension scripts in its own **Cache Storage** (`Lists-odsp-web-prod_<build>`) and runs them from there, whatever your `Cache-Control` header says. Site pages pick up the new file within minutes; list pages don't.
>
> **Ve zkratce.** Když SPFx rozšíření načítá bundle se stálou adresou (bez content-hashe – obvyklý trik, jak aktualizovat rozšíření bez nového `.sppkg`), stránky **seznamů a knihoven** mohou ještě dny spouštět starou kopii. Aplikace Seznamy si skripty rozšíření ukládá do vlastní **Cache Storage** (`Lists-odsp-web-prod_<build>`) a spouští je odtud bez ohledu na hlavičku `Cache-Control`. Běžné stránky webu novou verzi vezmou během minut, seznamy ne.

## Symptom

You publish a new version of the bundle behind a stable URL (for example `my-extension.js` on your CDN, `Cache-Control: max-age=600`). On a modern **site page** the new code runs right away. On a **document library or list view** in the same browser, the old code keeps running:

- a hard refresh (`Ctrl+Shift+R`) shows the new version,
- the next normal refresh shows the old one again,
- the network panel shows the script as served locally, so it looks like a caching glitch that should have expired long ago.

In our case the copy was **nine days old**, stored with `max-age=600`.

## Cause

The modern Lists experience keeps its own cache of scripts in the browser's Cache Storage API, one cache per Lists build (`Lists-odsp-web-prod_2026-09-04.002`, `Lists-odsp-web-prod_2026-09-11.002`, …). Your extension bundle ends up in it and is executed from it. There is no service worker involved (`navigator.serviceWorker.controller` is `null`) – the page code reads the cache itself, so HTTP caching rules don't apply. An entry in an older build's cache keeps winning even when a newer build's cache exists.

Modern site pages have similar caches (`SPClient-<id>`), but there a new file showed up immediately.

## How to confirm

Run in the console of a list or library page:

```javascript
for (const name of await caches.keys()) {
  const c = await caches.open(name);
  for (const req of await c.keys()) {
    if (req.url.includes('my-extension')) {
      const res = await c.match(req);
      console.log(name, req.url, res.headers.get('last-modified'));
    }
  }
}
```

An entry with an old `last-modified` is the copy that runs. Deleting it (`await c.delete(req)`) and doing a normal refresh runs the current file, and the Lists app stores the new copy.

## Fix

- **Don't put logic behind a stable URL.** Keep the stable file a tiny loader that rarely changes, and have it load the real code from a **versioned** URL (a version folder or a content hash). A new URL can't be served from an old cache entry.
- **Keep the stable part backwards compatible** with both older and newer versions of whatever it loads – for days, both combinations will be running at the same time.
- **Verify releases on a list page too**, and read Cache Storage first. Otherwise you measure the old copy and chase a bug that isn't in the code.
- Don't promise users that an extension update shows up "within minutes" everywhere.

## Related

- [A CDN-hosted SPFx bundle still needs a new `.sppkg`](cdn-hosted-bundle-still-needs-new-sppkg.md) – the opposite trap: hashed filenames pinned by the package manifest.
