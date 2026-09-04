---
title: X-RequestDigest expires ~30 min after page load — but adding it by hand in SPFx makes things worse
tags: [rest-api, spfx, writes]
applies-to: SharePoint Online (REST writes from a long-lived page; cross-site-collection writes)
last-reviewed: 2026-09-04
---

# X-RequestDigest expires ~30 min after page load

> **Bottom line.** A SharePoint REST write needs a valid form digest in `X-RequestDigest`, and the one baked into the page at load times out after ~30 minutes — so writes work at first, then 403 on a tab the user kept open. The fix depends on *how* you write. Raw `fetch` must carry a digest you fetched yourself from `/_api/contextinfo`. SPFx's `SPHttpClient` already does the whole job — and only when you have **not** set the header yourself, so adding it by hand switches its retry-on-403 off.
>
> **Ve zkratce.** SharePoint REST zápis potřebuje platný form digest v `X-RequestDigest` a ten stránkový po ~30 minutách expiruje – zápisy nejdřív fungují a pak spadnou na 403 na kartě, kterou má uživatel dlouho otevřenou. Oprava závisí na tom, ČÍM zapisujete. Syrový `fetch` musí nést digest, který jste si sami vytáhli z `/_api/contextinfo`. SPFx `SPHttpClient` to celé umí sám – ale jen když hlavičku **nenastavíte vy**, takže ruční digest mu vypne i zotavení z 403.

## Symptom

- Writes succeed right after the page loads, then start failing once the user has left the tab open for a while (a long form, a dashboard on a wall display, an SPFx web part whose "page" never reloads).
- Verbatim: `403 FORBIDDEN`, body `{"error":{"code":"-2130575251, Microsoft.SharePoint.SPException","message":{"value":"The security validation for this page is invalid and might be corrupted. Please use your web browser's Back button to try your operation again."}}}`.
- It often surfaces as a generic "couldn't save (check your permissions)" even though the user's permissions are fine.

## Cause

SharePoint requires a **form digest** (anti-CSRF token) on state-changing REST calls, sent as the `X-RequestDigest` header. Classic pages embed one in the `__REQUESTDIGEST` hidden field and code tends to reuse it. It is **time-limited** (~30 min by default, see `FormDigestTimeoutSeconds`) and tied to the page load. A page — or a single-page component — that outlives the digest sends a stale token and gets the 403. It is not a permissions problem; it is an expired token wearing a permissions-shaped error message.

## Fix — pick the branch that matches your write path

### Raw `fetch` (and anything else outside a digest-aware client)

Get a fresh digest immediately before the write:

```ts
async function getDigest(webUrl: string): Promise<string> {
  const res = await fetch(`${webUrl}/_api/contextinfo`, {
    method: 'POST',
    headers: { Accept: 'application/json;odata=nometadata' },
    credentials: 'include'
  });
  const json = await res.json();
  return json.FormDigestValue;   // send as the X-RequestDigest header on the write
}
```

- Safe default: fetch per write. The cost is one small POST; the payoff is that expiry can't bite.
- If you cache it, honour the `FormDigestTimeoutSeconds` the same response returns and refresh **before** it lapses — don't assume 30 minutes. And drop the cached value when a write returns 403, or the cache will keep replaying the token that just failed.

### SPFx `SPHttpClient` — do **not** set the header yourself

Read the shipped runtime rather than guessing (paths as of `@microsoft/sp-http` 1.22.2, in `node_modules`):

| What it does | Where |
|---|---|
| `configurations.v1` declares `requestDigest: true` | `SPHttpClientConfiguration` |
| every state-changing method gets `X-RequestDigest` from the digest cache | `SPHttpClientHelper.js:144-160` |
| the cache reads `FormDigestTimeoutSeconds` and re-POSTs `/_api/contextinfo` when it lapses | `DigestCache.js:29-70` |
| a 403 clears the cached digest so the next attempt fetches a new one | `DigestCache.js:181-190` |
| the target web for a cross-site call is derived from the request URL | `getWebUrlFromRequestUrl` |

The decisive line is the guard in `SPHttpClientHelper.js:150`:

```js
if (!headers.has('X-RequestDigest')) { /* ...attach a managed digest... */ }
```

Attaching your own header therefore **opts the call out** of the managed digest *and* out of the clear-on-403 recovery. A hand-rolled TTL cache makes it worse: after a 403 it keeps handing back the same stale token until its own interval expires, while the built-in cache would have discarded it immediately.

So in SPFx the correct question is **not** "does every write carry a digest?" It is: **"does any write leave `SPHttpClient` and go out through a raw `fetch`?"** Those are the ones that need a digest. The rest are already handled.

## Notes

- **Cross-site writes need the *target* site's digest, and they fail immediately.** Writing to a different site collection than the one hosting your page, the page/auto digest belongs to your *current* site and is invalid for the target — so the write 403s on the **very first attempt**, not after 30 minutes. With raw `fetch`, get the digest from `{otherSite}/_api/contextinfo`. With `SPHttpClient` the target web is derived from the request URL, so this is handled too.
- The related failure-messaging trap: catching this 403 and rendering "check your permissions" sends the user chasing a permissions ghost. Surface validation/digest errors distinctly.
- Same digest requirement applies to `validateUpdateListItem`, file uploads (`/Files/add`), and site-group membership changes (`/sitegroups(..)/users`) — again, only where you are the one issuing the request.
- PnPjs and the CSOM request executor manage the digest for you as well.
- **How this page changed (2026-09-04).** It used to end with "being explicit removes the surprise" — advice that is right for raw `fetch` and actively wrong inside `SPHttpClient`. The correction came from reading the runtime source, after a live-observed 403 had been "fixed" by sprinkling manual digests across a codebase. If you have that pattern today, don't rip it out blind either: A/B one write on a tab left open past the timeout, and let the measurement decide.
