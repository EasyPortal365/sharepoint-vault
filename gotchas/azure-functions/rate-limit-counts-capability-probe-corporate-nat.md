---
title: Per-IP rate limit counts the capability probe — corporate NAT kills the feature silently
tags: [azure-functions, rate-limiting, api-design, spfx-backend]
applies-to: Azure Functions (any anonymous HTTP endpoint behind a shared client IP)
last-reviewed: 2026-07-16
---

# Per-IP rate limit counts the capability probe — corporate NAT kills the feature silently

> **Bottom line.** A per-IP rate limit that also counts the cheap capability probe turns corporate NAT (one IP per office) into a silent feature kill switch — answer probes *before* the limiter and meter only expensive work.
>
> **Ve zkratce.** Per-IP rate limit, který započítává i levný capability probe, promění firemní NAT (jedna IP na celou kancelář) v tichý vypínač funkce – na probe odpověz *před* limiterem a měř jen drahou práci.

A pattern trap for SPFx web parts backed by an anonymous Azure Function: the web part ships to
everyone (CDN), but a given backend instance may or may not have a feature deployed/configured.
So the client sends a cheap **capability probe** on load — "what can you do?" — and hides the
feature's UI when the answer is empty. Sensible. Then the rate limiter eats it.

## Symptom

A feature works in testing, then **randomly disappears for parts of one organization** —
no console error, no failed request in sight, the UI simply stops offering it. Meanwhile the
same build works fine elsewhere.

## Cause

Three facts that are harmless alone and toxic together:

1. The endpoint has a **per-IP rate limit** (say 20/min), keyed on the rightmost
   `X-Forwarded-For` segment — correct anti-spoofing practice, since that segment is appended
   by the Azure front end and can't be forged by the caller.
2. That IP is the one **Azure sees** — behind corporate NAT that is *one address for the
   entire office*, not one per user. "20/min per IP" silently became "20/min per company".
3. The limiter ran **before** the request body was parsed, so the cheap capability probe
   (which only reads an app setting and fetches nothing) counted against the same budget as
   real work.

Twenty people opening the app in the same minute exhaust the limit with probes alone. The
21st user's probe gets **429**, the client's fail-safe reads any error as "feature not
available here", and the UI hides the feature. Nothing is logged as wrong anywhere — the
outage propagates itself.

## Fix

Order the handler so that cheap metadata answers never touch the limiter:

```ts
export async function handler(req: HttpRequest, ctx: InvocationContext): Promise<HttpResponseInit> {
  // 1. Parse the body first (cheap, bounded — invalid JSON is a 400, not a 500).
  let body: IRequestBody;
  try { body = await req.json() as IRequestBody; } catch {
    return { status: 400, jsonBody: { error: 'Invalid request.' } };
  }

  // 2. Capability probe (no `url` = "what are you configured for?") — answer BEFORE
  //    rate limiting. It only reads an env var; it performs no outbound work.
  if (!body.url) {
    return { status: 200, jsonBody: { allowed: allowedHosts() } };
  }

  // 3. Rate-limit only what does expensive work (outbound fetch, AI call, …).
  if (isRateLimited(clientIpOf(req), RATE_MAX)) {
    return { status: 429, jsonBody: { error: 'Too many requests.' } };
  }

  // 4. The actual work…
}
```

Rules of thumb:

- **Only meter expensive work.** Metadata/"what can you do?" questions are reads of your own
  config — let them through free.
- **Never assume IP ≈ user** on an anonymous endpoint. Corporate NAT means one IP per
  building. Size limits for that, or key on something better when you have it.
- On the **client**, treat gate failures individually: 404 (old backend) and 403 (not
  configured) legitimately mean "hide the feature"; **429 is a false negative** — don't let
  it latch. And cache only *successful* probe results; a cached failure freezes the feature
  off for the whole session.

## Notes

- The same trap applies to any "is it configured?" ping: health checks, feature flags,
  version handshakes. If the answer decides UI visibility, a metered probe turns your rate
  limiter into a feature kill switch.
- In-memory per-instance limiters (a `Map` of timestamps) reset on cold start and don't share
  state across scale-out — fine as an abuse backstop, but that's another reason they must not
  gate feature discovery.
- Found by reading the handler before release, not in production — the cheapest place to find it.
