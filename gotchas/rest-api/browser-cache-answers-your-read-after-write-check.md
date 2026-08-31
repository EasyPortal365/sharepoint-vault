---
title: The browser cache answers your read-after-write check — with a 200
tags: [rest-api, spfx, caching, idempotency, provisioning]
applies-to: SharePoint Online (SPFx / any browser-side REST client)
last-reviewed: 2026-08-31
---

# The browser cache answers your read-after-write check — with a 200

> **Bottom line.** When the same REST URL is read on both sides of a write, the second GET is often served by the browser's HTTP cache, so you are told the state from *before* the write. It arrives with status 200, so `if (!res.ok) throw` never fires. Bust the cache on every read that verifies a write or decides one — and only on those.
>
> **Ve zkratce.** Když se tatáž REST URL čte před zápisem i po něm, druhý GET obslouží prohlížeč z vlastní cache – dostaneš stav z doby PŘED zápisem. Přijde se stavem 200, takže `if (!res.ok) throw` se nikdy nespustí. Cache obcházej u každého čtení, které zápis ověřuje nebo o něm rozhoduje – a jen u nich.

## Symptom

Two shapes, and they lie in opposite directions.

**False failure.** A step reports that it did not work, while REST run by hand shows it did:

```
Securing lists: NOT FINISHED (9)
```

…although `GET .../HasUniqueRoleAssignments` on all nine lists returns `true`. Nothing is broken except the check.

**False success — the dangerous one.** A "find the row, else create it" upsert silently creates a *second* row for the same logical key, on a single tab with no concurrency involved. From then on the code reads one row (`$top=1`) and writes another: the setting appears to save ("Saved"), and never takes effect.

The provisioning variant of the same thing is worse, because SharePoint helps it along:

```ts
// existence check — the only guard against duplicates
const chk = await sp.get(`${list}/fields/getbyinternalnameortitle('MyField')`, cfg);
if (chk.ok) return;                 // exists → skip
await sp.post(`${list}/fields`, cfg, { body: fieldBody });
```

`POST /fields` with an already-existing `Title` **does not error** — it creates a duplicate column with an auto-suffixed internal name (`MyField0`, `MyField1`). One cached check therefore damages the schema permanently and reports success.

## Cause

`SPHttpClient.get()` (and any `fetch`) is a normal browser request. The browser may answer it from its HTTP cache, keyed by the **full URL**. Read the same URL before and after a write and the second read is a very plausible cache hit — the response comes back with **status 200** and a body from before the write.

Measured on one URL at one moment: default `fetch` → `false`, `cache: 'no-store'` → `true`.

Three things make this hard to see:

- **`res.ok` guards do not help.** A cached response is a 200. Code comments claiming "we check the status, so this is handled" are exactly the ones that are not handled.
- **It is not only "verification after a write".** Any read used as the *base state* for a write is the same class: an existence check before an insert, the merge base for a partial update, an ETag for an optimistic lock (a cached ETag means permanent 412), a document-number check before issuing the next number, a "is the lock free?" read.
- **It disguises itself as an API quirk.** Comparing `?@l=…&$select=…` against `?$select=…&@l=…` and finding different results looks like a parameter-ordering rule. It is not: the second form is simply a **different URL that the cache did not have**. Fixing "parameter order" would also appear to work — and would leave the real cause in every other call site.

## Fix

Add a one-shot parameter to reads on the write path. Use a counter as well as the clock: two calls inside the same millisecond would otherwise produce the same URL.

```ts
let seq = 0;
/** One-shot URL so the browser cannot answer this read from its cache. */
export function noCache(url: string): string {
  seq += 1;
  return url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now() + '_' + seq;
}

// existence check that actually asks the server
const chk = await sp.get(noCache(`${list}/fields/getbyinternalnameortitle('MyField')`), cfg);
```

`cache: 'no-store'` in the request init works too, where the client lets you pass it through.

**Do not do this globally in your shared `get()` helper.** It is tempting — it looks like one change that closes the whole class — but it disables caching for list and content reads as well, which is a real regression for throttling. Bust only:

- verification of a write you just made (permissions, membership, a list you just created),
- an existence check that decides an insert or a create,
- a "strict" getter whose value becomes the merge base for the next write,
- the singleton lookup in an upsert (`$filter=Key eq '…'&$top=1`),
- ETags used for optimistic concurrency, and distributed-lock reads.

Leave the ordinary display reads cached: list items, reference data such as role definitions, tenant-level properties.

## How to prove it took, not just that it compiles

Two cheap checks, both worth keeping:

1. **Live A/B on one URL.** Request the same address twice — plain, and with a cache-buster (or `cache: 'no-store'`). If the answers differ, you were reading a cache, not the server. Do this *before* theorising about API semantics.
2. **Assert on the URLs, with a negative control.** In a test, drive the flow (read → write → read) against a fake client that records URLs, and assert that the two reads used **different** URLs. Then disable the helper (replace it with the identity function) and assert the test *fails* — a detector nobody has seen fail proves nothing.

## Notes

- Keep the helper's **name identical across the codebase**. It turns "where do we still read stale state?" into one grep, and moving it into a shared package later becomes a mechanical import swap.
- A failure reported by a *check* deserves a second, independent channel (one manual REST read) before you start fixing the thing it accuses. Here that one read showed the writes had all succeeded and the measurement was the bug.
- Related: [Check-then-insert races produce duplicate rows](check-then-insert-races-duplicate-rows.md) — the same duplicate, caused by genuine concurrency rather than the cache; the fixes complement each other.
- Related: [`fields/getbyinternalnameortitle` 400s for a missing field](getbyinternalnameortitle-400-not-404.md) — the other way that existence check goes wrong.
- Scripts that run against a tenant are read-after-write too. A sweep that reads before and after its own writes, and is run repeatedly in the same browser, will report on its previous run instead of on the tenant.
