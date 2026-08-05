---
title: "Retrying a throttled call is safe for GET only"
tags: [rest-api, throttling, reliability, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-08-05
---

# Retrying a throttled call is safe for GET only

> **Bottom line.** Honouring `Retry-After` is a clear win on reads and a data-corrupting bug on writes — a throttled `POST` may well have succeeded on the server before the response was lost, so retrying it creates a second list item nobody asked for.
>
> **Ve zkratce.** Respektovat `Retry-After` je u čtení jednoznačná výhra a u zápisů chyba, která poškodí data – throttlovaný `POST` mohl na serveru klidně projít a jen se ztratila odpověď, takže jeho zopakováním vznikne druhá položka, kterou nikdo nechtěl.

## Symptom

You add a retry layer to your SharePoint REST calls, because on busy tenants requests occasionally come back as:

```text
HTTP 429 Too Many Requests
Retry-After: 12
```

Reads get noticeably more reliable. Then duplicate rows start appearing in lists — always in pairs, always identical apart from `Id` and a second or two in `Created`. Nobody clicked twice, and the logs show one user action.

The pattern is worst on exactly the operations you care about: a form submit under load, a bulk import, an audit run at nine in the morning.

## Cause

`429` (and `503`) means "the server refused to serve this **now**". It does not mean "the server did nothing".

A write can be throttled at several points, and only one of them is safe to repeat:

| Where it was throttled | Did the item get created? | Safe to retry |
|---|---|---|
| Request rejected at the front door | no | yes |
| Request processed, response throttled or dropped | **yes** | **no** |
| Timeout with no response at all | unknown | **no** |

From the client, all three look identical: no usable response. SharePoint's REST API has **no idempotency key** — there is no header you can send that makes the server recognise "this is the same write I already accepted". So a retried `POST` is a new, independent write, and `MERGE` on a list item is no better when the payload is a computed value rather than an absolute one.

This is the same underlying problem as [check-then-insert races](check-then-insert-races-duplicate-rows.md): lists have no unique constraint, so nothing downstream stops the duplicate.

## Fix

Retry on the HTTP method, not on the status code. `GET` and `HEAD` are idempotent, so repeating them costs time and nothing else:

```typescript
const RETRIABLE = [429, 503];

async function spFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  // Only idempotent methods may be repeated. A throttled write may already
  // have been applied server-side, and SharePoint has no idempotency key
  // that would let the server recognise the retry.
  const mayRetry = method === 'GET' || method === 'HEAD';
  const maxAttempts = mayRetry ? 4 : 1;

  let attempt = 0;
  for (;;) {
    attempt++;
    const res = await fetch(url, init);

    if (RETRIABLE.indexOf(res.status) === -1 || attempt >= maxAttempts) {
      return res;   // success, a non-retriable error, or out of attempts
    }

    // Retry-After is seconds in practice; fall back to a growing delay.
    const header = res.headers.get('Retry-After');
    const waitSec = header ? parseInt(header, 10) : 0;
    const delay = waitSec > 0 ? waitSec * 1000 : Math.pow(2, attempt) * 500;
    await new Promise(function (r) { setTimeout(r, delay); });
  }
}
```

For writes you have three honest options, in order of preference:

1. **Surface the failure.** Return the 429 to the caller and let a human press the button again. A user who sees "the server is busy, try again" is cheaper than a duplicate you have to find later.
2. **Make the write verifiable.** Give the item a natural key the client controls, and before any retry, read back and check whether it already exists — that read is a `GET`, so it may retry freely.
3. **Deduplicate on read.** When duplicates are tolerable in storage but not in the UI, collapse them when reading rather than deleting the "extra" one; deleting by lowest `Id` throws away the row other references already point at.

What you must not do is wrap `POST` in the same generic retry helper as `GET` because it was convenient.

## Notes

- **`RateLimit-*` headers are not guaranteed for delegated calls.** They are documented mainly for application-context requests, and delegated SPFx calls often come back without them. A throttling dashboard built on those headers shows blanks on the tenants you most want to measure — treat `null` as "not reported", not as "no throttling", and keep `Retry-After` plus timing patterns as the fallback signal.
- Reading the headers must never break the call itself. Older `Response` objects in some polyfilled environments do not expose them; wrap the read in try/catch.
- If you aggregate throttling telemetry per endpoint, normalise the URL first (GUIDs → `{id}`, numbers → `{n}`, quoted literals → `{s}`). Without it the cardinality of your aggregation equals the number of calls, and the report tells you nothing.
- Related: [Don't cache a throttled permission probe](dont-cache-a-throttled-permission-probe.md) — the other way a 429 quietly turns into wrong behaviour, by being remembered as a permission answer.
- Related: [Silent read failure drives delete-all](silent-read-failure-drives-delete-all.md) — a throttled *read* that resolves to an empty array is how a sync deletes everything.
