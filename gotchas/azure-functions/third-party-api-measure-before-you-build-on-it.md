---
title: The best-known public API may be the worst one — measure before you build on it
tags: [azure-functions, third-party-api, rate-limiting, caching, reliability]
applies-to: Any server-side code calling a free public API on a user-facing path
last-reviewed: 2026-08-08
---

# The best-known public API may be the worst one — measure before you build on it

> **Bottom line.** "Everyone uses it" says nothing about whether it answers: the canonical free API returned 404/502/timeout on 7 of 8 live calls while a lesser-known alternative answered all 8 in under 2.6 s — measure latency *and* error rate on real data before you ship, because a green test suite only proves your stub matches your assumption.
>
> **Ve zkratce.** „Používají to všichni" nevypovídá o tom, jestli to odpovídá: kanonické veřejné API vrátilo na 7 z 8 živých volání 404/502/timeout, zatímco méně známá alternativa odpověděla na všech 8 do 2,6 s – změř latenci *i* chybovost na reálných datech dřív, než to nasadíš, protože zelené testy dokazují jen shodu stubu s tvým předpokladem.

A user-facing feature needed data from a free public API. The obvious choice was the
canonical one — the service everyone links to, free, no key required, first hit in
every search. It was implemented against that service, unit tests passed, and it
looked done.

## Symptom

The feature returned "couldn't determine that" for most real inputs. Unit tests
stayed green the whole time, because the stub answered exactly as expected.

A live probe against production endpoints, two rounds over four inputs:

| Source | Result |
|---|---|
| Canonical, best-known API | `404`, `502`, `404`, `502`, timeout at 25 s, `404`, `404`, and **one success at 14.9 s** |
| Lesser-known alternative | **8 successes, 134–2598 ms** |

Not an outage. That was the steady state.

## Cause

Two independent failures, and the test suite could see neither:

1. **A stub proves format, not availability.** Mocking `fetch` verifies that your
   parser matches the shape you assumed. It says nothing about whether the service
   responds, how fast, or how often it 502s.
2. **The alternative had a rate limit that a shared egress IP burns through fast.**
   After switching, some inputs still failed — but after ~1 s, not after a timeout.
   A direct request showed the real reason:

   ```
   HTTP 429
   Retry-After: 135
   {"code":"rate_limited"}
   ```

   Roughly 15 requests from one IP exhausted the unauthenticated quota. A Function
   App has **one outbound IP for all users**, so the limit is per instance, not per
   visitor: a handful of concurrent visitors kills the feature for everyone.

## Fix

**Measure first.** Before building a user-facing feature on a third-party API, probe it
on real inputs, two rounds, printing latency *and* HTTP status:

```js
async function probe(name, url, timeoutMs) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.text();
    return `${name}: HTTP ${res.status}, ${body.length} B (${Date.now() - t0} ms)`;
  } catch (e) {
    return `${name}: FAILED ${e.name} (${Date.now() - t0} ms)`;
  } finally {
    clearTimeout(timer);
  }
}
```

Two rounds matter: one bad round is an outage, two are a trend. Printing latency
matters too — `unknown` after 1 s (rate limit) and `unknown` after 12 s (timeout) look
identical in the result but need opposite fixes.

**Then protect the quota.** Two measures, both entirely in your hands:

```ts
const TTL_MS = 24 * 60 * 60 * 1000;   // match the TTL to how fast the data changes
const CACHE_MAX = 500;
const cache = new Map<string, { t: number; val: Result }>();
let blockedUntil = 0;

async function lookup(key: string): Promise<Result> {
  const hit = cache.get(key);
  if (hit) {
    if (Date.now() - hit.t <= TTL_MS) return hit.val;
    cache.delete(key);
  }

  // After a 429, do not touch the service until Retry-After expires. Calling it
  // just to get another 429 makes the user wait for nothing.
  if (Date.now() < blockedUntil) return { failed: true };

  const res = await fetch(url);
  if (res.status === 429) {
    const ra = parseInt(res.headers.get('retry-after') ?? '', 10);
    blockedUntil = Date.now() + (isNaN(ra) ? 120 : Math.min(ra, 3600)) * 1000;
    return { failed: true };   // NOT cached
  }
  if (!res.ok) return { failed: true };   // NOT cached

  const val = parse(await res.text());
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next();   // Map preserves insertion order
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { t: Date.now(), val });
  return val;
}
```

Four rules that are easy to get wrong:

- **Match the TTL to the data, not to habit.** If the underlying data changes monthly,
  a 24 h TTL costs nothing in freshness and removes most requests — users routinely
  repeat the same query two or three times in a row.
- **Never cache failures.** One outage would otherwise silence the feature for the
  whole TTL. Cache successes only.
- **Cap whatever the remote server tells you** (`Math.min(retryAfter, 3600)`). It can
  send anything.
- **Fail to "unknown", never to a finding.** If the lookup didn't happen, say so — do
  not let a missing answer render as a negative result.

## The test trap that follows

Caching breaks any test suite that runs many scenarios against the same key: scenario
two silently receives scenario one's cached value, and from then on the suite measures
the cache instead of the logic. Export a reset whose name makes its purpose obvious
(`__resetCacheForTest()`) and call it between scenarios.

Then add the test that actually protects the quota — one that **counts real calls**:

```js
let calls = 0;
const inner = stubFetch(scenario);
global.fetch = (url, opts) => {
  if (String(url).indexOf('api.example.com/') !== -1) calls++;
  return inner(url, opts);
};

resetCache();
await run('example.com');
await run('example.com');
await run('example.com');
assert(calls === 1, `cache broken: ${calls} calls instead of 1`);
```

Without it, someone reorders two lines, the cache quietly stops working, and nobody
notices until the 429s show up in production.

## Related

- [Per-IP rate limit counts the capability probe](rate-limit-counts-capability-probe-corporate-nat.md) — the mirror image: your *own* limiter miscounting a shared IP
- [Don't cache a throttled permission probe](../rest-api/dont-cache-a-throttled-permission-probe.md) — when caching a failure is actively harmful
