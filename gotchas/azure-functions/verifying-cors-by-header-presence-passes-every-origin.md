---
title: "Verifying CORS by header presence passes every origin — compare the value to the Origin you sent"
tags: [azure-functions, cors, verification, security, testing]
applies-to: Azure Functions (any language), any API that returns a fallback Access-Control-Allow-Origin
last-reviewed: 2026-09-02
---

# Verifying CORS by header presence passes every origin

> **Bottom line.** A preflight probe that asks *"did the response carry `Access-Control-Allow-Origin`?"* answers **yes for every origin**, including ones the allowlist rejects — because an API with a static allowlist typically returns a **fallback** origin (the first entry) rather than omitting the header. The only honest test is whether the returned value **equals the `Origin` you sent**; anything else is what the browser will refuse. And if a probe reports the *same* verdict for all inputs — all allowed or all denied — suspect the probe, not the product.
>
> **Ve zkratce.** Sonda ptající se *„vrátila odpověď hlavičku `Access-Control-Allow-Origin`?“* odpoví **ano u každého originu**, i u těch, které allowlist odmítá – API se statickým allowlistem totiž obvykle vrací **náhradní** origin (první položku), místo aby hlavičku vynechalo. Jediný poctivý test je, jestli se vrácená hodnota **shoduje s `Origin`, který jsi poslal**; cokoli jiného prohlížeč odmítne. A když sonda hlásí u všech vstupů **týž** výsledek – všechno povoleno, nebo všechno zamítnuto – podezřívej sondu, ne produkt.

## Symptom

You tighten a CORS allowlist (say: stop honouring `http://localhost:*` on the production
instance), deploy, and probe it:

```bash
curl -s -D - -o /dev/null -X OPTIONS "$HOST/api/thing" \
  -H "Origin: https://evil.example" \
  -H "Access-Control-Request-Method: POST" \
| grep -i "^access-control-allow-origin:"
```

The header comes back. Your script prints **allowed** — for `https://evil.example`, for
`http://localhost:3000`, for everything. Either you conclude the deployment did nothing, or (worse)
you conclude the allowlist is broken and go looking for a bug that is not there.

## Why it happens

Two independent reasons, and both are ordinary:

**1. The server answers with a fallback origin.** A common implementation shape is:

```ts
const allow = originSet(PROD_WEB, CDN, devOrigins());
const origin = allow.has(req.headers.get('origin') ?? '') 
  ? req.headers.get('origin')! 
  : allow.values().next().value;      // ← fallback, not omission
return { headers: { 'Access-Control-Allow-Origin': origin } };
```

That is not a bug. A response with a *non-matching* `Access-Control-Allow-Origin` is exactly as
rejected as one with no header at all — the browser compares the value to its own origin and
fails the request. But a `grep` for the header name cannot tell the two apart.

**2. You probed the wrong route.** Function routes are frequently not the file or function name
(`app.http('thingHandler', { route: 'v1/thing' })` → `/api/v1/thing`). A 404 carries no CORS
headers, so **every** origin comes back "denied" and four out of five expectations look satisfied.

## What to do instead

Compare, and state the expectation per case so a uniform result cannot hide:

```bash
zkus() {                       # origin, expected(allowed|denied), label
  local h
  h=$(curl -s -D - -o /dev/null -X OPTIONS "$HOST$EP" \
        -H "Origin: $1" -H "Access-Control-Request-Method: POST" \
      | tr -d '\r' | grep -i "^access-control-allow-origin:" | cut -d' ' -f2-)
  local actual="denied"; [ "$h" = "$1" ] && actual="allowed"
  [ "$actual" = "$2" ] && echo "OK    $1 $actual" || { echo "WRONG $1 $actual"; FAIL=$((FAIL+1)); }
}

zkus "https://app.example.com" allowed "canonical origin"
zkus "http://localhost:3000"   denied  "dev origin"
zkus "https://evil.example"    denied  "foreign origin"
exit $FAIL
```

Two properties matter more than the comparison itself:

- **At least one case must expect `allowed`.** A suite where everything is expected to be denied
  passes against a 404, a stopped app, or a typo in the host name.
- **Exit on mismatch.** A probe whose output you read by eye will eventually be read as "looks
  fine" — the exit code is what a later automation can trust.

## How to verify the probe itself

Point it at a route you know does **not** exist. Every case must report `denied`, and the
canonical-origin case must therefore **fail** the suite. If your probe stays green against a
nonexistent endpoint, it is measuring nothing.

## Notes

- Some stacks *do* omit the header for unknown origins, and some echo the request origin
  unconditionally (which is its own vulnerability). Comparing the value handles all three shapes;
  checking presence handles none of them.
- `Access-Control-Allow-Credentials: true` combined with an echoed origin is the dangerous
  variant worth grepping for separately — with credentials in play, an echo is effectively
  `Access-Control-Allow-Origin: *` with cookies attached.
- Platform-level CORS (the Function App's own CORS blade in Azure) and in-code CORS are two
  different layers. If the portal list is non-empty it answers preflights **before** your code
  runs, and your carefully written allowlist never executes.
