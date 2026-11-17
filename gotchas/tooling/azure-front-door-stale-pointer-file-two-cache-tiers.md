---
title: Azure Front Door serves a stale pointer file for longer than max-age after you publish
summary: "Front Door caches in two tiers and per Accept-Encoding variant, so a fixed-URL index (versions.json, a signed release index) can stay stale ~12 min with max-age=600; curl without compression hits a cold variant and looks fresh. Give pointer files a short s-maxage, and test with Accept-Encoding: br"
tags: [cdn, azure-front-door, caching, s-maxage, deployment, spfx]
applies-to: SPFx solutions (or any web app) whose loader reads a fixed-URL JSON index from a CDN behind Azure Front Door Standard/Premium to decide which build to load
last-reviewed: 2026-11-17
---

# Azure Front Door serves a stale pointer file for longer than max-age after you publish

> **Bottom line.** Versioned bundles can be cached forever, but the small file that points at them (`versions.json`, a release index) has a fixed URL and changes on every publish. Behind Azure Front Door with `Cache-Control: max-age=600` it can stay stale for well over 10 minutes, because Front Door caches in two tiers and keeps a separate copy for each compression variant. Give pointer files a short `s-maxage` (Front Door prefers it over `max-age`), and when you test, send the same `Accept-Encoding: br` the browser sends.
>
> **Ve zkratce.** Verzované bundly se smí cachovat napořád, ale malý soubor, který na ně ukazuje (`versions.json`, index vydání), má pevnou adresu a mění se při každé publikaci. Za Azure Front Doorem s `Cache-Control: max-age=600` může zůstat starý i přes 10 minut, protože Front Door cachuje ve dvou vrstvách a pro každou variantu komprese drží vlastní kopii. Ukazatelům dej krátké `s-maxage` (Front Door ho upřednostní před `max-age`) a při testu posílej stejné `Accept-Encoding: br` jako prohlížeč.

## Symptom

- You publish a new build and update the index. For 5–12 minutes the loader in the browser still gets the previous index, doesn't find the new version, and falls back to an older one.
- `curl https://cdn.example.com/app/index.json` returns the new file the whole time, so the CDN "looks fine".
- The difference looks like it depends on the `Origin` header (browser fetch vs. curl). It doesn't.

## Cause

Response headers from Front Door tell the story:

```
Vary: Accept-Encoding
Cache-Control: max-age=600
X-Cache: TCP_HIT
X-Cache-Info: L1_T2
```

1. **TTL comes from the origin.** Front Door takes the cache duration from `s-maxage`, then `max-age`, then `Expires` ([Caching with Azure Front Door – Cache expiration](https://learn.microsoft.com/azure/frontdoor/front-door-caching#cache-expiration)). With `max-age=600` every cached copy lives 600 s from when it was stored.
2. **Two tiers.** `L1_T2` means the response passed through two cache tiers. If one tier refreshes its copy from the other just before that copy expires, it holds the old bytes for another full TTL. So the worst case is more than one `max-age`.
3. **One copy per compression variant and per edge node.** With `Vary: Accept-Encoding`, `br`, `gzip` and uncompressed responses are cached separately. Browsers always ask for `br`, so that variant is always warm and stale. A plain `curl` asks for the uncompressed variant, which nobody requested recently. It gets `TCP_MISS`, goes to the origin, and returns fresh bytes. `Origin` is not part of the cache key.
4. **`fetch(url, { cache: 'no-cache' })` doesn't help.** It makes the browser revalidate with the edge, not with your origin. The edge answers from its own copy.

## Fix

Give the files that change on every publish a short shared-cache TTL and keep the browser TTL:

```
Cache-Control: max-age=600, s-maxage=60
```

- On Azure Blob Storage (static website) this is the blob's `x-ms-blob-cache-control` property, so set it per file in your upload script: pointer files get `s-maxage`, versioned files keep `max-age`.
- Only the pointers need it. Versioned bundles and hashed chunks never change, and long caching is what you want there.
- Purging after every deploy is weaker. It can take [up to 10 minutes to propagate](https://learn.microsoft.com/azure/frontdoor/cache-purge), and the deploy identity needs a role on the Front Door profile.
- `no-cache`/`no-store` from the origin turns Front Door caching off for that file completely. That works too, but every page load then reaches the origin.

On the client: if the loader finds that the version it wants is missing from the index, it should first fetch the index once more with a cache-busting query (`?t=<now>`; Front Door includes the query string in the cache key only if the route is configured that way). Only then should it fall back. And it shouldn't cache that fallback for longer than the edge TTL.

## How to check

Compare `X-Cache`, `ETag` and `Last-Modified` the way a browser would see them:

```bash
curl -s -o /dev/null -D - -H "Accept-Encoding: br" https://cdn.example.com/app/index.json | grep -iE "x-cache|etag|last-modified|cache-control"
```

Without the `Accept-Encoding` header you are testing a different cached copy.
