---
title: "`process.exit()` right after `fetch()` can crash Node on Windows, and the exit code then lies"
short-title: "`process.exit()` after `fetch()` lies about the exit code on Windows"
summary: "On Windows (seen on Node.js 24), `process.exit()` called while the built-in `fetch()` is still closing its keep-alive connection sometimes aborts on a libuv assertion (`UV_HANDLE_CLOSING`, exit code 127), so a check that has just printed OK reports a failure — intermittently. After the first network call, set `process.exitCode` and let the process finish; call `process.exit()` only before it"
tags: [tooling, node, windows, fetch, ci, release]
applies-to: Node.js scripts on Windows that use the built-in `fetch()` (undici) and decide their exit code afterwards (seen on Node.js 24.16)
last-reviewed: 2026-09-25
---

# `process.exit()` right after `fetch()` can crash Node on Windows, and the exit code then lies

> **Bottom line.** On Windows, a Node.js script that calls `process.exit()` right after `fetch()` sometimes dies on a libuv assertion while the keep-alive connection is still closing. The process then returns the crash code (127), not the one you passed, so a check that just printed "OK" reports a failure, and only now and then. After the first network call, set `process.exitCode` and let the process end on its own; call `process.exit()` only before any request.
>
> **Ve zkratce.** Node skript na Windows, který zavolá `process.exit()` hned po `fetch()`, občas spadne na aserci libuv, zatímco se ještě zavírá keep-alive spojení. Proces pak vrátí kód pádu (127), ne ten, který jsi předal – kontrola, která právě vypsala „OK“, ohlásí selhání, a to jen občas. Po prvním síťovém volání nastav `process.exitCode` a nech proces doběhnout; `process.exit()` volej jen před prvním požadavkem.

## Symptom

A release script checks that a freshly published version is live: it fetches every file from the CDN, compares hashes and exits with 0 or 1. The caller reads the exit code and decides whether the version may be activated. Once in a while the log shows this (messages translated):

```text
POOL: LIVE OK - 2 files of version x/1.3.0.4 return 200 and the build content
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
```

The exit code is 127 (or another crash code), so the caller reports the version as not verified, even though the files are live and correct. The same script run again passes. Against the real CDN it did not reproduce in 11 consecutive runs. Against a local test server it failed every time.

## Cause

The built-in `fetch()` (undici) keeps the connection alive after the response and closes it asynchronously. `process.exit()` does not wait for pending asynchronous work. It tears the process down at once, including handles that are halfway through closing. On Windows this sometimes trips an assertion in libuv's handle bookkeeping, and the process ends with the crash code instead of the code passed to `exit()`. Whether it happens depends on timing, which is why the failure comes and goes and why a fast local server makes it deterministic.

## Fix

After the first network call, never end the script with `process.exit()`. Set the code and let the event loop drain:

```js
// before: can crash on Windows and return 127 instead of 0/1
const bad = await verify();          // uses fetch()
if (bad) { console.log('FAILED'); process.exit(1); }
console.log('OK');
process.exit(0);

// after: the exit code is exactly what the check decided
const bad = await verify();
console.log(bad ? 'FAILED' : 'OK');
process.exitCode = bad ? 1 : 0;      // no exit(): the process ends when the loop is empty
```

- In a top-level script where later code must not run (for example a "verify" mode followed by a "publish" section), put the rest in an `else` branch or return from a `main()` function. Otherwise removing `exit()` lets the script fall through.
- `process.exit()` is still fine before the first request: invalid arguments, a missing input file.
- Test both exit paths, OK and failure. To make a check fail after a real `fetch()`, point it at a dead proxy (`NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:9`) with a short timeout. The run must end with 1, not a crash code.

## Notes

- The ending may take a few seconds longer while the keep-alive connection times out. That is the price of an exit code you can trust.
- Any script whose exit code drives a decision is affected: publish and verify steps, build guards, CI checks. The same crash hit a second, unrelated checker in the same week.

## References

- [Node.js documentation: `process`](https://nodejs.org/api/process.html) — `process.exit()` ends the process even while asynchronous operations are still pending; for a normal end the documentation recommends setting `process.exitCode` and letting the process exit on its own.
