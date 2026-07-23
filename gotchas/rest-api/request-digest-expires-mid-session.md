---
title: X-RequestDigest expires ~30 min after page load
tags: [rest-api, spfx, writes]
applies-to: SharePoint Online (REST writes from a long-lived page)
last-reviewed: 2026-07-23
---

# X-RequestDigest expires ~30 min after page load

> **Bottom line.** A SharePoint REST write (POST/MERGE/DELETE) needs a valid form digest in `X-RequestDigest`. The digest baked into the page at load times out after ~30 minutes, so writes work at first and then 403 "the security validation for this page is invalid" on a page the user kept open. Fetch a fresh digest from `/_api/contextinfo` right before each write — don't reuse the page digest.
>
> **Ve zkratce.** SharePoint REST zápis (POST/MERGE/DELETE) potřebuje platný form digest v `X-RequestDigest`. Digest vložený do stránky při načtení po ~30 minutách expiruje, takže zápisy nejdřív fungují a pak spadnou na 403 „the security validation for this page is invalid" na stránce, kterou má uživatel dlouho otevřenou. Před každým zápisem si vytáhni čerstvý digest z `/_api/contextinfo` – nepoužívej ten stránkový.

## Symptom

- Writes succeed right after the page loads, then start failing once the user has left the tab open for a while (a long form, a dashboard on a wall display, an SPFx web part whose "page" never reloads).
- Verbatim: `403 FORBIDDEN`, body `{"error":{"code":"-2130575251, Microsoft.SharePoint.SPException","message":{"value":"The security validation for this page is invalid and might be corrupted. Please use your web browser's Back button to try your operation again."}}}`.
- In SPFx it often surfaces as a generic "couldn't save (check your permissions)" even though the user's permissions are fine.

## Cause

SharePoint requires a **form digest** (anti-CSRF token) on state-changing REST calls, sent as the `X-RequestDigest` header. Classic pages embed one in the `__REQUESTDIGEST` hidden field and code tends to reuse it. It is **time-limited** (~30 min by default, see `FormDigestTimeoutSeconds`) and tied to the page load. A page — or a single-page SPFx component — that outlives the digest sends a stale token and gets the 403. It is not a permissions problem; it is an expired token wearing a permissions-shaped error message.

## Fix

Get a fresh digest immediately before the write:

```ts
async function getDigest(spHttpClient: SPHttpClient, webUrl: string): Promise<string> {
  const res = await spHttpClient.post(
    `${webUrl}/_api/contextinfo`,
    SPHttpClient.configurations.v1,
    { headers: { Accept: 'application/json' } }
  );
  const json = await res.json();
  return json.FormDigestValue;   // send as the X-RequestDigest header on the write
}
```

- Safe default: fetch per write. The cost is one small POST; the payoff is that expiry can't bite.
- If you must cache it, honour the `FormDigestTimeoutSeconds` the same response returns and refresh **before** it lapses — don't assume 30 minutes.
- `SPHttpClient` auto-attaches a digest for many same-site POSTs, which is why some code "works" until it doesn't (cross-method `MERGE`/`DELETE` via `X-HTTP-Method`, raw `fetch`, or a very old page). Being explicit removes the surprise.
- PnPjs and the CSOM request executor manage this for you; raw `fetch` / `SPHttpClient` writes are where it bites.

## Notes

- The related failure-messaging trap: catching this 403 and rendering "check your permissions" sends the user chasing a permissions ghost. Surface validation/digest errors distinctly — or just always send a fresh digest so the state can't arise.
- Same digest requirement applies to `validateUpdateListItem`, file uploads (`/Files/add`), and site-group membership changes (`/sitegroups(..)/users`).
