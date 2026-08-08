---
title: Wrapping MSGraphClientV3 to count calls fails silently — and your fail-safe catch hides it
tags: [spfx, graph, telemetry, instrumentation, monkey-patching]
applies-to: SharePoint Framework (SPFx), MSGraphClientV3
last-reviewed: 2026-08-08
---

# Wrapping MSGraphClientV3 to count calls fails silently — and your fail-safe catch hides it

> **Bottom line.** The obvious way to instrument Graph calls — reassigning `client.api` on the instance returned by `msGraphClientFactory` — does not take effect. In strict mode (which every TS module is) the assignment throws, and because instrumentation is written to be fail-safe, the `catch` swallows it. Nothing breaks, nothing is measured, nothing is logged. Build the wrapper with `Object.create` instead, and assert that the assignment stuck.

## Symptom

You add call counting / throttle tracking around Microsoft Graph in an SPFx web part. SharePoint REST calls are recorded fine. Graph calls record **zero** — not a wrong number, exactly zero — while the app works normally and the console is clean.

It reads as "this app doesn't call Graph", which is the one conclusion nobody double-checks.

## Cause

Two things combine:

1. `MSGraphClientV3` instances handed out by `context.msGraphClientFactory.getClient()` do not accept a reassignment of `api`. Under strict mode that assignment raises a `TypeError`.
2. Instrumentation is (correctly) written to never break the call it wraps, so it sits inside `try { … } catch { /* no telemetry, but a working client */ }`. That catch now hides a total failure rather than an edge case.

```ts
// ❌ looks right, does nothing
const orig = client.api.bind(client);
client.api = (path) => wrapRequest(orig(path), path);   // throws, swallowed
```

## Fix

Do not mutate the client — return a child object whose prototype *is* the client. Assignment on a fresh, extensible object always works, everything else is inherited, and `api()` delegates to the real client as the receiver so no internal state is touched through the wrong `this`.

```ts
const TERMINALS = ['get', 'post', 'patch', 'put', 'delete'];

function wrapRequest(req: { [k: string]: unknown }, path: string): unknown {
  // fluent methods (.version(), .select(), .header()) return `this`,
  // so overriding the terminals once on this instance is enough
  TERMINALS.forEach(m => {
    const fn = req[m];
    if (typeof fn !== 'function') return;
    const call = fn as (...a: unknown[]) => Promise<unknown>;
    req[m] = function (...args: unknown[]): Promise<unknown> {
      return call.apply(req, args).then(
        (out) => { record(path, 200); return out; },
        (e) => { record(path, statusOf(e), e); throw e; }
      );
    };
  });
  return req;
}

export function instrument(c: MSGraphClientV3): MSGraphClientV3 {
  const real = c as unknown as { api?: (p: string) => unknown };
  if (typeof real.api !== 'function') return c;
  const origApi = real.api;

  const proxy = Object.create(c) as { api?: (p: string) => unknown };
  proxy.api = (path: string) => wrapRequest(origApi.call(c, path) as never, path);

  // ⚠ the whole point: prove the assignment took
  if (proxy.api === origApi) { console.warn('Graph instrumentation did not attach'); return c; }
  return proxy as unknown as MSGraphClientV3;
}
```

Apply it at the single place the client is produced, not at each call site:

```ts
const factory = {
  getClient: (v: string) => context.msGraphClientFactory.getClient(v as '3').then(instrument)
};
```

Wrapping per call site works too, but the gap returns with the first newly written `client.api(...)` — and nobody notices, because the symptom is a number that is merely low.

## What you can and cannot measure this way

- ✅ call counts per endpoint, and 429/503 with `Retry-After` when the client surfaces headers on the error
- ❌ quota headroom (`RateLimit-*`) on success — the client hands you the parsed body, never the response

## Traps

- **A fail-safe `catch` may swallow a failure, but it must not swallow the fact that the feature is off.** Wherever `catch` means "silent no-op", put an assertion next to it that the thing actually attached. Otherwise you ship a feature that pretends to measure.
- **Verify instrumentation against an independent signal, never against itself.** "Telemetry says 0" and "the app makes no calls" look identical from the inside. The browser's network tab settled it here: 7 requests to `graph.microsoft.com` during one scan versus 0 recorded.
- **Do not add retries in the wrapper.** Graph carries writes as well as reads; a helpfully retried `sendMail` sends twice.

## See also

- [Unknown managed properties fail silently](../search/unknown-managed-properties-fail-silently.md) — the same shape of bug: a quiet zero that reads as a fact
