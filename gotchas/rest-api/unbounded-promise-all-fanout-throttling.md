---
title: Unbounded Promise.all fan-out over a customer-sized collection invites HTTP 429
tags: [rest-api, throttling, performance, spfx]
applies-to: SharePoint Online (REST from client-side code)
last-reviewed: 2026-08-24
---

# `Promise.all` over "one request per item" works on your tenant and throttles on theirs

> **Bottom line.** Fan-out is safe when the number of requests is decided by *your code* and dangerous when it is decided by *the customer's data*. One request per library, per vehicle, per registered app, per selected row — that count grows with the tenant, and at some size SharePoint answers 429 instead.
>
> **Ve zkratce.** Rozstřel dotazů je bezpečný, když počet určuje TVŮJ kód, a nebezpečný, když ho určují ZÁKAZNÍKOVA data. Jeden dotaz na knihovnu, na vozidlo, na vybraný řádek — takový počet roste s tenantem a od určité velikosti odpoví SharePoint 429 místo dat.

## Symptom

Everything is fast in development and at your pilot customer. At a larger tenant the same screen sometimes loads partially, sometimes shows an error, and the pattern is not reproducible — it depends on how much data that customer has. In the network tab you see a burst of dozens of simultaneous requests, some of which come back `429 Too Many Requests` with a `Retry-After` header.

## Cause

The classic shape:

```ts
const lists = await getAllLists();                       // count decided by the customer
const perList = await Promise.all(
  lists.map(l => fetchNewestItems(l.id))                 // one request each, all at once
);
```

This is not a bug you can see in the code — it is a bug you can only see in someone else's tenant. A site with eight libraries fires eight requests; a site with sixty fires sixty, simultaneously, from one browser. SharePoint's throttling is per-user and per-tenant, and a burst is exactly what it is designed to reject.

It gets worse when the fan-out nests: each outer call itself batches internally, so twenty outer items × twenty inner rows becomes four hundred requests from a single click.

## Fix

**Distinguish the two kinds of fan-out.** If the collection length is a constant in your source (four groups, three intervals, two versions), `Promise.all` is fine and you should keep it — that is a fixed cost. If the length comes from the customer's data, bound it.

Two bounded patterns, both dependency-free:

```ts
// A. batches — simplest, good when order does not matter
const BATCH = 6;
const out: T[] = [];
for (let i = 0; i < items.length; i += BATCH) {
  const chunk = items.slice(i, i + BATCH);
  const done = await Promise.all(chunk.map(fetchOne));
  for (let k = 0; k < done.length; k++) out.push(done[k]);
}
```

```ts
// B. worker pool — better throughput, keeps a fixed number in flight
const CONCURRENCY = 4;
let cursor = 0;
const results: Array<R | undefined> = new Array(items.length);
async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++;
    if (i >= items.length) return;
    results[i] = await fetchOne(items[i]);   // write by INDEX → order preserved
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
```

**Better than bounding: do not ask at all.** Often the fan-out exists to compute something small — the newest few documents across all libraries, a count per group. Sort by `LastItemModifiedDate` and query only the freshest handful; ask for counts with `$select=Id&$top=1` and `$inlinecount`; or fetch per-item detail lazily, only for the page the user is actually looking at.

**When you do cap coverage, say so.** Silently querying the ten newest libraries and presenting the result as "everything" is worse than being slow. Log what was skipped, or show it.

## Where to look in your own code

```
Promise.all(
```

For each hit, answer one question: **who decides the length of that array — me, or the customer?** If it is the customer, it needs a bound. Pay particular attention to "select all" in a list view: a bulk action that maps over the current selection can turn one click into thousands of writes.
