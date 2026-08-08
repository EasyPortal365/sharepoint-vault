---
title: Cache-Control on a dynamic endpoint is an edge layer you can't invalidate
tags: [azure-functions, caching, cache-control, api-design, cdn]
applies-to: Any HTTP endpoint returning live/aggregated data behind a shared cache or CDN
last-reviewed: 2026-08-08
---

# Cache-Control on a dynamic endpoint is an edge layer you can't invalidate

> **Bottom line.** Putting `Cache-Control: max-age=…` on a dynamic aggregate hands every shared cache permission to hold that response keyed by URL — and then neither restarting the app nor deleting the underlying data clears it; only expiry does. Serve live data with `no-store`, cache server-side where you control invalidation, and have the consumer call with a cache-buster.
>
> **Ve zkratce.** `Cache-Control: max-age=…` na dynamickém agregátu dá každé sdílené cache právo držet odpověď klíčovanou na URL — a pak ji nesmaže ani restart appky, ani smazání zdrojových dat; jen expirace. Živá data servíruj s `no-store`, cachuj server-side (kde invalidaci ovládáš) a konzument ať volá s cache-busterem.

A public endpoint returned an aggregate — "X % of checked domains lack DMARC", computed
from stored rows. To lighten the Function App it got, almost reflexively:

```
Cache-Control: public, max-age=1800
```

## Symptom

Verifying the aggregate meant a seed-verify-cleanup: insert ~50 temporary rows, confirm
the endpoint crosses its "enough data" threshold, delete the temporary rows.

The confirm worked — `ready:true, total:54`. But cleanup didn't stick from the outside:

- Deleted all 50 temp rows from storage → **the bare URL still returned `total:54`**.
- Restarted the Function App (clears in-memory cache) → **still `total:54`**.
- Queried storage directly → **4 rows. The server was clean the whole time.**

`curl` and the browser were both reading an edge cache, not the server.

## Cause

`max-age` on a dynamic response tells **every shared cache** on the path — Azure's
front-end/ARR, any CDN, any proxy — that it may hold the response, and it's keyed by URL.
The bare URL became one edge entry that outlived:

- **an app restart** — that clears the app's own in-memory state, but not a cache layer
  in front of it;
- **a data cleanup** — the cache serves its stored copy without ever asking the server.

You can't invalidate that entry without access to the cache layer. It clears when
`max-age` expires — 30 minutes here — and not before.

## The diagnosis that cracked it

```bash
curl "$URL"                       # stale: total:54 (edge copy)
curl "$URL?_=$(date +%s%N)"       # fresh: total:0  (cache-buster → different key → server)
```

**Bare URL differs from URL-with-random-query ⇒ you're reading a cache, not the server**,
and restarting the app won't help. That one comparison localizes the problem in seconds.

## Fix

**Don't let a shared cache hold live data.** Server-side caching (in-memory, with a TTL)
already absorbs the load and you control its invalidation — a restart clears it, and no
external layer second-guesses you.

```ts
// endpoint
headers['Cache-Control'] = 'no-store';   // NOT max-age — this is live data
```

```js
// consumer
fetch(url + '?_=' + Date.now());         // unique key → always reaches the server
```

`max-age` is for static or versioned assets (their URL changes when the content does),
never for a live aggregate served from a stable URL.

## Rules

1. **Dynamic aggregate/state → `no-store`.** Move the load-shedding to a server-side
   cache you can invalidate, not to an edge layer you can't.
2. **Consumers of a dynamic endpoint call with a cache-buster** (`?_=Date.now()`), so
   stale data has nowhere to lodge even behind a helpfully-configured intermediary.
3. **Seed-verify-cleanup against production is risky whenever a cache sits in front.**
   Fake data may not vanish with the storage cleanup — it survives in the cache tier.
   No staging? At least call through a cache-buster and expect expiry-bound staleness.
4. **Stale-response triage:** compare the bare URL to the URL with a random query. If
   they differ, you're reading cache; an app restart is the wrong lever.

## Related

- [Measure a third-party API before you build on it](third-party-api-measure-before-you-build-on-it.md) — the other half of "verify live, not from assumptions"
