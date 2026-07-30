---
title: A library with NoCrawl returns nothing from Search — and silently blinds anything built on Search
tags: [search, crawl, indexing, rag, ai, provisioning, governance]
applies-to: SharePoint Online
last-reviewed: 2026-07-30
---

# A library with `NoCrawl` returns nothing from Search — and silently blinds anything built on Search

> **Bottom line.** `NoCrawl: true` on a list or library removes it from the search index with no error and no log — and because RAG/Copilot-style features query Search, the content becomes permanently invisible to them no matter how the AI side is configured. Provisioning code that sets `NoCrawl` on *data* lists must not inherit that default onto *content* libraries.
>
> **Ve zkratce.** `NoCrawl: true` na seznamu nebo knihovně ho vyřadí z indexu bez chyby a bez logu – a protože RAG funkce se ptají Search, obsah je pro ně navždy neviditelný bez ohledu na nastavení AI. Kdo nastavuje `NoCrawl` na *datové* seznamy, nesmí ten default zdědit na knihovny s *obsahem*.

## Symptom

A document library holds real content — Markdown, PDFs, HTML, images. It opens fine, REST reads it fine, your app works over it. But:

```
GET /_api/search/query?querytext='* Path:"https://contoso.sharepoint.com/sites/team/MyLibrary"'
→ TotalRows: 0
```

HTTP 200. Empty result. No error anywhere. Users report "the AI assistant doesn't know about our documents" or "I can't find these files in search", and the AI configuration screen looks perfectly correct.

## Cause

The list has `NoCrawl: true`. That flag ("Allow items from this list to appear in search results" = No, in *Advanced settings*) excludes the whole container from the crawler.

The reason it hides for so long is that **the failure mode is silence**. A missing managed property behaves the same way (see [unknown-managed-properties-fail-silently](unknown-managed-properties-fail-silently.md)) — Search's contract is "return what matches", and nothing matching is a legitimate answer. Neither the crawler nor the query API has any way to say "this container is deliberately excluded".

Where the flag usually comes from:

* **Provisioning code.** Setting `NoCrawl: true` on application data lists (settings, logs, conversation history, lookup tables) is *correct* — that plumbing has no business in tenant-wide search. The bug is inheriting the same default onto document libraries, which exist to hold content.
* **Site templates / governance scripts** applying a blanket "keep our stuff out of search" rule.
* **A site-level `NoCrawl`** on `_api/web` — check that too; it excludes everything beneath it.

## Fix

Check both levels before assuming anything:

```javascript
// Site level
GET /_api/web?$select=Title,NoCrawl

// List / library level
GET /_api/web/GetList('/sites/team/MyLibrary')?$select=Title,NoCrawl,ItemCount
// (address by URL, not Title: ../rest-api/get-list-by-url-not-by-title.md)
```

Then flip it. From a browser console (raw `fetch`), the `_api` endpoint defaults to **OData v3** semantics, so the body needs `__metadata` — sending `@odata.type` returns `400 '@odata.type' is an invalid instance annotation name.` (Inside SPFx, `SPHttpClient` forces `odata-version: 4.0` and you need exactly the opposite shape — see [metadata-body-requires-verbose](../rest-api/metadata-body-requires-verbose.md).)

```javascript
const digest = (await (await fetch(web + '/_api/contextinfo', {
  method: 'POST', headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'include'
})).json()).FormDigestValue;

await fetch(web + "/_api/web/GetList('/sites/team/MyLibrary')", {
  method: 'POST', credentials: 'include',
  headers: {
    'Accept': 'application/json;odata=verbose',
    'Content-Type': 'application/json;odata=verbose',
    'X-RequestDigest': digest, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE'
  },
  body: JSON.stringify({ __metadata: { type: 'SP.List' }, NoCrawl: false })
});
```

**Then verify by reading the property back.** A `204` means the request was accepted, not that the state is what you wanted.

### Getting the content indexed now

Clearing the flag does not re-crawl immediately, and content the crawler previously skipped will not necessarily be picked up on the next incremental pass. You cannot force a reindex over REST — the relevant property (`vti_x005f_searchversion`) lives in the root folder's property bag, and:

```
POST .../RootFolder/Properties  (X-HTTP-Method: MERGE)
→ 400 The type SP.PropertyValues does not support HTTP PATCH method.
```

So either wait for the continuous crawl, or click it: **Library settings → Advanced settings → Reindex Document Library**, reachable directly at `/_layouts/15/advsetng.aspx?List={list-guid}`. (PnP PowerShell's `Request-PnPReIndexList` does the same thing via CSOM.)

### If you fix the default in shared provisioning code

Check *when* your code writes the flag. A common pattern is that list provisioning re-applies settings on every run while library provisioning only sets them at creation — meaning a corrected default reaches **new** deployments only, and every existing tenant stays excluded forever. That needs a separate reconciliation step which reads the actual state and patches only the difference.

Do not hang that reconciliation on a schema-version bump: patching list settings requires `ManageLists`, so if the first run happens under a regular member it returns 403, and if the version got saved anyway the repair would never be retried. Gate it on the **real state you just read**, and record "done" only after a proven success.

## Is un-hiding it a security problem?

No — and this is worth saying out loud, because "let's keep it out of the index so nobody finds it" is a common instinct.

SharePoint Search is **security-trimmed at query time**: results are filtered to what the asking user already has permission to read. Indexing a library with broken inheritance does not expose it to people outside those permissions. `NoCrawl` is a *discoverability* setting, not an access control — anyone with read access could always reach the content by direct URL.

The corollary matters too: if content genuinely must not be seen, `NoCrawl` was never protecting it. Fix the permissions.

## Rule of thumb

Ask **what the container holds**, not what type it is:

| Content | Index? |
|---|---|
| App state, settings, logs, conversation history, lookup tables | No — noise in tenant search |
| Documents, knowledge articles, attachments, published `.md` | **Yes** — that's what search and AI are for |

And when you verify, always include a **control query** that must return something (e.g. the site itself). Without it, `0` only tells you "either the content is missing or my query is wrong", and you cannot tell which.
