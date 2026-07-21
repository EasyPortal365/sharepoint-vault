---
title: A request body with __metadata must be sent as odata=verbose
tags: [rest-api, odata, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-22
---

# A request body with `__metadata` must be sent as `odata=verbose`

> **Bottom line.** `__metadata` only exists in the OData verbose format — either drop it and stay in the modern `nometadata` default, or set both `Accept` and `Content-Type` to `odata=verbose`.
>
> **Ve zkratce.** `__metadata` existuje jen ve formátu OData verbose – buď ho vynech a zůstaň v moderním defaultu `nometadata`, nebo nastav `Accept` i `Content-Type` na `odata=verbose`.

## Symptom

A POST or MERGE copied from an older tutorial — the kind that includes a type hint:

```json
{ "__metadata": { "type": "SP.Data.TasksListItem" }, "Title": "Hello" }
```

fails with **HTTP 400**:

```
InvalidClientQueryException: The property '__metadata' does not exist on type 'SP.Data.TasksListItem'.
```

## Cause

`__metadata` only exists in the **OData verbose** wire format. Modern clients (SPFx `SPHttpClient`, plain `fetch` with `Content-Type: application/json`) talk `nometadata`/`minimalmetadata` by default — and in those modes SharePoint treats `__metadata` as an unknown *field* of your list item, hence the 400.

The trap is common because half the SharePoint REST examples on the internet date from the verbose era and carry `__metadata` in every body.

## Fix

Pick one side and be consistent:

**A. Drop `__metadata`** and stay in the modern default — for ordinary field updates the type hint isn't needed:

```ts
headers: { 'Accept': 'application/json;odata=nometadata', 'Content-Type': 'application/json' },
body: JSON.stringify({ Title: 'Hello' })
```

**B. Keep `__metadata`** (some legacy endpoints and payload shapes want it) — then *both* headers must say verbose:

```ts
headers: {
  'Accept': 'application/json;odata=verbose',
  'Content-Type': 'application/json;odata=verbose'
},
body: JSON.stringify({ __metadata: { type: 'SP.Data.TasksListItem' }, Title: 'Hello' })
```

> ⚠️ **SPFx caveat — under `SPHttpClient`, option B still 400s.** `SPHttpClient.configurations.v1` injects an `odata-version: 4.0` request header you cannot easily strip. Paired with a verbose (`__metadata`) body, SharePoint reads it as OData v4 JSON Light and rejects it — **HTTP 400: *"Parsing JSON Light feeds or entries in requests without entity set is not supported"*** — regardless of the list's age. So inside SPFx, **always take option A** (`nometadata`, no `__metadata`). Verified live A/B 2026-07-22: an identical body returns **201** via plain `fetch` but **400** the moment `odata-version: 4.0` is present; `nometadata` without `__metadata` returns **201/204** either way. Note the two different 400 messages — the `InvalidClientQueryException` above (mode mismatch, no version header) vs. this JSON-Light parse error (verbose body + v4 header) — both point to the same fix.

If your codebase mixes both styles, the robust move is a tiny helper that inspects the body and sets the headers accordingly — then nobody has to remember.

## Notes

- Mixed symptoms of the same class: verbose *response* shapes are nested under `d` (`data.d.results` vs `data.value`) — check which mode you're in before parsing.
- When debugging any SharePoint REST 400, A/B-test plain vs verbose with a harmless payload (a no-op MERGE) before touching your real code — it isolates the wire-format factor in one minute.
