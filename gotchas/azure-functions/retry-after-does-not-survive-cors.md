---
title: "`Retry-After` does not survive CORS — a header you send and the client reads can still arrive as null"
tags: [azure-functions, cors, rate-limiting, spfx, browser, headers]
applies-to: Any browser client reading a response header from a cross-origin API (Azure Functions, any stack)
last-reviewed: 2026-09-18
---

# `Retry-After` does not survive CORS

> **Bottom line.** A cross-origin response only lets the browser expose the headers named in **`Access-Control-Expose-Headers`**, plus a short safelist. Everything else is stripped from the client's view — so an API that carefully returns `Retry-After` on 429, and a client that carefully reads `response.headers.get('Retry-After')`, can still end up with `null` and a back-off that ignores the delay the service asked for. Both sides look correct in review and in a grep; the missing piece is the list *between* them. `curl` shows the header, the browser does not — so verify from the browser, and guard it with a test over the build.
>
> **Ve zkratce.** U cross-origin odpovědi dá prohlížeč přečíst jen hlavičky vyjmenované v **`Access-Control-Expose-Headers`** plus krátkou safelisted sadu. Všechno ostatní klientovi zmizí – takže API, které u 429 pečlivě posílá `Retry-After`, a klient, který pečlivě čte `response.headers.get('Retry-After')`, spolu skončí u `null` a u čekání, které doporučenou dobu ignoruje. Obě strany přitom vypadají správně při revizi i v grepu; chybí výčet *mezi* nimi. `curl` hlavičku ukáže, prohlížeč ne – ověřuj tedy z prohlížeče a hlídej to testem nad buildem.

## Symptom

The API returns a considered delay on rate-limit errors:

```ts
if (response.status === 429) {
  const retryAfter = response.headers.get('retry-after') || '20';
  return {
    status: 429,
    headers: { ...corsHeaders, 'Retry-After': retryAfter },
    jsonBody: { error: 'Service is busy.' }
  };
}
```

The client reads it and backs off accordingly:

```ts
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get('Retry-After');   // always null in a browser
  const sec = header ? parseInt(header, 10) : NaN;
  return !isNaN(sec) ? Math.min(sec * 1000, 30000) : BASE_MS * (attempt + 1);
}
```

Yet retries land 2 s, 4 s and 6 s apart, even when the upstream service asked for 60. Measured from
a page on the calling origin, the value is plainly missing while the response undeniably carries it:

```js
const r = await fetch(API, { method: 'POST', /* … */ });
console.log(r.status, r.headers.get('retry-after'));   // 429 null
```

## Cause

`Access-Control-Expose-Headers` was never set, and `Retry-After` is **not** on the CORS-safelisted
response header list. The safelist is only:

`Cache-Control` · `Content-Language` · `Content-Length` · `Content-Type` · `Expires` · `Last-Modified` · `Pragma`

Anything else — `Retry-After`, `ETag`, `Location`, `X-Request-Id`, any `X-…` of your own — is
invisible to JavaScript unless the server names it. Nothing errors, nothing logs: `get()` simply
returns `null` and the fallback path takes over, which is why this can sit in production for months.

## Fix

Name the headers where the CORS headers are assembled, so every response path carries the list:

```ts
const headers: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers': 'Retry-After',
  'Vary': 'Origin'
};
```

`Access-Control-Expose-Headers` applies to the **actual** response, not the preflight, so it has to
be on the response the client reads — putting it only on the `OPTIONS` branch changes nothing.

## Rules

1. **Any header your server adds beyond the safelist, and a client reads, needs to be exposed.**
   Treat the expose list as part of the API contract, not as CORS boilerplate.
2. **Verify header visibility from the browser, never from `curl`.** CORS is a rule for browsers;
   `curl` sees every header and will happily confirm a contract the browser then breaks.
3. **Guard it with a test over the build, not over the source.** Find the headers handlers add to
   the shared CORS object and assert each one is exposed — that catches the *next* header too:
   ```js
   const re = /\.\.\.(?:corsHeaders|CORS_HEADERS)\s*,\s*(['"])([A-Za-z0-9-]+)\1\s*:/g;
   ```
   A text scan sees only the shape written today, so prove the detector by **sabotage**: inject an
   extra header into a copy of the real bundle and assert the check reports it. A green guard that
   was never shown to fail proves nothing.
   **And cut comments out of whatever window you scan.** Our first guard searched the lines
   around `status: 429` for the text `Retry-After` and passed over a sabotaged bundle — because
   the comment three lines above the return *mentions* the header. It was measuring the comment
   about the fix rather than the fix, and would have stayed silent over code with the header
   removed. Strip line comments and match syntax (the header as an object key), not a word.
4. **Sending the header is a separate rule from exposing it.** Our own per-IP rate limiter
   returned 429 with no `Retry-After` at all, and because its window is 60 s while the client
   retried at 0/2/6 s, all three attempts fell inside the same window — the user got an error
   for something the app had just failed three times in a row, and a manual retry was no help
   either. The honest value is not a flat minute but the time until the oldest timestamp
   leaves the sliding window. Make the rule exceptionless — *every* 429 carries `Retry-After`,
   including daily caps where the value runs to thousands of seconds — because an exception
   you cannot state is an exception nobody can guard.
5. **When a header "disappears", suspect the boundary, not the two ends.** Grepping the name finds
   the send and the read and looks complete; the defect lives in neither file.

## See also

- [Verifying CORS by header presence passes every origin](verifying-cors-by-header-presence-passes-every-origin.md) — the other way CORS verification lies to you.
- [Azure OpenAI 429: measure prompt size, not request frequency](aoai-429-measure-prompt-size-not-frequency.md) — the 429 that brought this to light.
