---
title: Calling SharePoint REST like a pro
tags: [rest-api, spfx, odata, guide]
applies-to: SharePoint Online (most of it also SharePoint Server)
last-reviewed: 2026-07-15
---

# Calling SharePoint REST like a pro

> **Bottom line.** Most SharePoint REST pain comes from three things the docs gloss over: which of the two clients (and OData worlds) you're in, the headers that actually matter, and how to write data safely. Get those right and the sharp edges mostly disappear.
>
> **Ve zkratce.** Většina bolesti se SharePoint REST pramení ze tří věcí, které dokumentace obchází: ve kterém ze dvou klientů (a OData světů) jste, které hlavičky doopravdy rozhodují, a jak bezpečně zapisovat data. Zvládněte je a ostré hrany z velké části zmizí.

SharePoint's REST API is powerful, well-documented in the happy path — and full of sharp edges the docs don't mention. This guide is the map we wish we'd had: which client to use, which headers actually matter, how to write data without surprises, and how to diagnose the inevitable 400.

## 1. Two clients, two OData worlds

| Context | Client | Auth | OData default |
|---|---|---|---|
| SPFx web part / extension | `SPHttpClient` | handled for you (including request digest) | **4.0**, `minimalmetadata` |
| Browser console, bookmarklet, external script | `fetch` with cookies | session cookie + **`X-RequestDigest`** for writes | whatever you send |

Two consequences people trip over:

- `SPHttpClient` silently adds `OData-Version: 4.0`. Legacy endpoints that only speak OData 3 (search, `/Files/add`) fail until you override it — see the header table below.
- Payload style must match the OData mode: modern calls use `'@odata.type': '#SP.List'`; the old `__metadata: { type: 'SP.List' }` belongs to `odata=verbose` **only** — [mixing them is a guaranteed 400](../gotchas/rest-api/metadata-body-requires-verbose.md).

Getting a request digest outside SPFx:

```ts
const ctx = await (await fetch(`${webUrl}/_api/contextinfo`, {
  method: 'POST',
  headers: { 'Accept': 'application/json;odata=nometadata' }
})).json();
// ctx.FormDigestValue → send as X-RequestDigest on every write; refresh before it expires
```

## 2. The headers that matter

Hard-won pairings — when a call fails with 400/406/500 and you don't know why, check this table first:

| Call | Headers that work | If you get it wrong |
|---|---|---|
| `GET …/items`, most reads | `Accept: application/json;odata=nometadata` | — (this one's forgiving) |
| `POST …/lists`, `…/items`, `…/fields` | `Accept: application/json` (plain!) | `odata=nometadata` on these POSTs → **406**, and the item may be created anyway — you get an error *and* a side effect |
| Anything `/_api/search/*` | `odata-version: 3.0` + `Accept: application/json;odata=nometadata` | [500 UnknownError, search only](../gotchas/rest-api/search-api-needs-odata-version-3.md) |
| `POST …/Files/add(…)` | `Accept: application/json;odata=verbose` + `OData-Version: 3.0` | [406 "ACCEPT header missing or invalid"](../gotchas/rest-api/file-upload-406-needs-verbose.md) |
| Body contains `__metadata` | `Accept` **and** `Content-Type` `application/json;odata=verbose` | [400 "property '__metadata' does not exist"](../gotchas/rest-api/metadata-body-requires-verbose.md) |

## 3. Writing data

**Create** — POST to the items collection; prefer resolving the list [by URL, not title](../gotchas/rest-api/get-list-by-url-not-by-title.md):

```ts
await spHttpClient.post(
  `${webUrl}/_api/web/GetList(@u)/items?@u='${listUrl}'`,
  SPHttpClient.configurations.v1,
  {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ Title: 'Hello', EventDate: new Date(input).toISOString() })
  });
```

**Update** — POST with method-override headers (works everywhere, including old servers):

```ts
headers: {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'X-HTTP-Method': 'MERGE',
  'IF-MATCH': '*'          // or a concrete etag for optimistic concurrency
}
```

**Delete** — same shape with `X-HTTP-Method: DELETE`. Consider `POST …/items(id)/recycle()` instead — recoverable beats gone.

Field-value traps to know before your first write: [DateTime wants full ISO](../gotchas/rest-api/datetime-write-full-iso-read-local-day.md) · [lookup/person fields are written via `<Name>Id`](../gotchas/rest-api/lookup-fields-need-expand.md) · [Choice fields validate nothing](../gotchas/rest-api/choice-fields-accept-any-value.md) · [apostrophes in OData literals double](../gotchas/rest-api/odata-string-literals-and-apostrophes.md).

**Non-negotiable: check `res.ok` on every write and read the body on failure.** SharePoint's error messages usually name the real problem — a silently swallowed 400 becomes "the feature randomly doesn't work" three weeks later:

```ts
if (!res.ok) {
  const body = await res.text().catch(() => '');
  throw new Error(`Save failed (HTTP ${res.status}): ${body.slice(0, 300)}`);
}
```

## 4. Reading well

- `$select` only what you render; add `$expand` for [lookup and person columns](../gotchas/rest-api/lookup-fields-need-expand.md), `$expand=File&$select=File/Length` for [file size and version](../gotchas/rest-api/file-size-needs-expand-file.md).
- Past a few thousand items, [page with `odata.nextLink`](../../snippets/rest/get-all-list-items-paged.md) — `$skip` is silently ignored on items — and make sure your `$filter` [leads with an indexed column](../gotchas/lists/list-view-threshold-and-indexes.md).
- OData text filters are **case-sensitive** (`substringof('kamil', Title)` won't find "Kamil"). For user-facing search-as-you-type, fetch a candidate set and filter client-side, or use SP Search.

## 5. Creating lists and fields over REST

Provisioning-style calls have their own micro-rules:

- Field types go through the base type + `FieldTypeKind` — some specific OData types simply don't exist:

  ```ts
  { '@odata.type': '#SP.Field', FieldTypeKind: 8, Title: 'IsActive' }      // Boolean — '#SP.FieldBoolean' is NOT a thing
  { '@odata.type': '#SP.Field', FieldTypeKind: 9, Title: 'Amount' }        // Number  — '#SP.FieldNumber' neither
  { '@odata.type': '#SP.FieldText', FieldTypeKind: 2, Title: 'Code' }      // this one exists
  ```

- Don't set `Indexed: true` at creation time — SharePoint may answer **500** (index limits); create the field first, index it as a separate step.
- Prefer *try-create-and-tolerate-exists* over *check-then-create* — existence probes cost an extra round trip and some of them return 406 through `SPHttpClient` anyway.

## 6. When it fails anyway — the ten-minute diagnosis

1. **Read the response body.** Not just the status. The body names the field, the type, the missing header.
2. **406?** Wrong `Accept` for that endpoint family — see the table in §2.
3. **400 on a write?** A/B-test it: same call as a harmless no-op (a MERGE with one known-good field) in plain mode vs verbose mode. One minute, and you know whether it's the wire format or your payload.
4. **500 only on search?** It's the [`odata-version` header](../gotchas/rest-api/search-api-needs-odata-version-3.md). It's always the header.
5. **Works for you, empty for users?** Same query returning rows to one account and zero (HTTP 200!) to another is usually item-level security (`ReadSecurity`) or permissions — check *which account* you're testing with before blaming cache.
6. **Don't trust adjacent evidence.** "The admin portal shows the data" or "it works in the browser address bar" does not prove *your* call path — different client, different headers, different auth. Reproduce with the failing client before concluding anything.

---

*Every claim above earned its place by breaking something first. Corrections and additions welcome — see [CONTRIBUTING](../CONTRIBUTING.md).*
