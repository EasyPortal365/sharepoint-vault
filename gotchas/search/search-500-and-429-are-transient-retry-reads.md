---
title: Search REST returns 500 "unknown error" and 429 "low resources" for minutes at a time — retry the read, don't fix the query
short-title: Search 500 / 429 without Retry-After are transient — retry the read
summary: SharePoint Search REST can fail for a few minutes with HTTP 500 SearchServiceException and HTTP 429 low-resources errors, both without Retry-After; the same query succeeds seconds later, so retry reads briefly with a fixed backoff and show a truthful error with a Try again button
tags: [search, rest-api, throttling, retry, error-handling]
applies-to: SharePoint Online Search REST (/_api/search/query, /_api/search/postquery), SPFx SPHttpClient
last-reviewed: 2026-11-12
---

# Search REST returns 500 "unknown error" and 429 "low resources" for minutes at a time — retry the read, don't fix the query

> **Bottom line.** A Search REST call that fails with HTTP 500 `SearchServiceException` ("An unknown error occurred") or HTTP 429 ("The query could not be completed because the system is low on resources") is usually the service, not your KQL — and neither response carries `Retry-After`. Retry the read twice with a short fixed backoff, then show an honest error with a *Try again* button.
>
> **Ve zkratce.** Když Search REST vrátí HTTP 500 `SearchServiceException` („Došlo k neznámé chybě“) nebo HTTP 429 („systém má málo prostředků“), bývá to služba, ne tvoje KQL – a ani jedna odpověď nenese `Retry-After`. Čtení zopakuj dvakrát s krátkou pevnou prodlevou a pak ukaž poctivou chybu s tlačítkem *Zkusit znovu*.

## Symptom

A web part lists sites with a security-trimmed Search query such as:

```text
(contentclass:STS_Site OR contentclass:STS_Web) -Path:"https://contoso-my.sharepoint.com"
```

Usually it works. Then, for a few minutes, it fails with:

```json
{"odata.error":{"code":"-1, Microsoft.Office.Server.Search.REST.SearchServiceException",
 "message":{"lang":"en-US","value":"An unknown error occurred."}}}
```

…interleaved with HTTP 429 and the message *"The query could not be completed because the system is low on resources."*

Measured live in one tenant, same user, same request headers (`odata-version: 3.0` included):

| Probe | Result |
|---|---|
| The site query from the root site, three times | 200 each time |
| The same query from another site, three times | 500 each time |
| `querytext='*'` from that other site | 500 |
| One minute later: root site | 500; the other site 200 |
| A few minutes later: `*` ten times, 2 s apart | 10 × 200 |
| Deliberately broken KQL (`(contentclass:STS_Site OR`) | 200 |
| A non-existent managed property | 200 |
| `Retry-After` header on any 500 or 429 | absent |

The first two rows look like a site-specific problem. They aren't one. The pattern dissolves as soon as you repeat the probe a minute later.

## Cause

The Search service is briefly overloaded or failing. Nothing is wrong with the query, the site the call is made from, or the data. Malformed KQL doesn't produce a 500 either: Search tolerates it and returns 200.

Generic retry helpers often miss this case for two reasons:

- They retry only 429 and 503, and only when `Retry-After` is present. Search sends neither the header nor (here) a 503.
- They don't retry 500 at all, because for most REST endpoints a 500 is a real bug.

## Fix

Wrap every Search **read** (GET `query`, read-only POST `postquery`) in a short retry that treats 429, 500, 502, 503 and 504 as transient:

```ts
const DELAYS = [1500, 4000];          // ~5.5 s total; past that, let the user decide
const TRANSIENT = [429, 500, 502, 503, 504];

async function searchWithRetry(run: () => Promise<Response>): Promise<Response> {
  let r = await run();
  for (let i = 0; i < DELAYS.length && !r.ok && TRANSIENT.includes(r.status); i++) {
    const ra = Number(r.headers.get('Retry-After'));
    if (ra > 10) break;                                   // don't park the UI for a minute
    await new Promise(res => setTimeout(res, Math.max(DELAYS[i], (ra || 0) * 1000)));
    r = await run();
  }
  return r;                                               // caller still checks r.ok
}
```

Then make the failure honest. Say that search is temporarily not responding, not that access was denied or that there are no sites, and put a **Try again** button next to the message. The button reruns only this one read, not the whole page.

## Notes

- **One permanent 500 looks the same.** Search also returns 500 when an `SPHttpClient` call omits `odata-version: 3.0` (see [Search REST needs `odata-version: 3.0`](../rest-api/search-api-needs-odata-version-3.md)). The retry only delays that error by a few seconds, so always send the header.
- **Diagnose before you touch the KQL.** Run `*` against the same site, then against a second site, then the same call again a minute later. A 500 and a 200 for the same query in the same minute means the service, not the query.
- **Never retry writes.** Search reads are idempotent. List and file writes aren't (see [Retry on throttling only for GET](../rest-api/retry-on-throttling-only-for-get.md)).
