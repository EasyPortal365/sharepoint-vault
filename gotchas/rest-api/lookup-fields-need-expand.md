---
title: Lookup and person fields — read with $expand, write with <Name>Id
tags: [rest-api, fields, lookup]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-15
---

# Lookup and person fields: read with `$expand`, write with `<Name>Id`

## Symptom

Two flavours of the same confusion:

- `$select=Owner/Title` fails with **HTTP 400** complaining about the field — or `$select=Owner` returns nothing useful.
- Writing `{ "Owner": "megan@contoso.com" }` (or an object) fails, and nothing in the error suggests what shape SharePoint actually wants.

## Cause

Lookup and person columns (person fields *are* lookups — into the hidden User Information List) are **relations, not values**. REST exposes them in two halves:

- the raw foreign key: an integer, surfaced as **`<InternalName>Id`** (`OwnerId`),
- the related entity's fields: reachable only via **`$expand=<InternalName>`** plus `$select=<InternalName>/<Field>`.

Neither half looks like the display value you see in the UI, and the API won't hint at the convention.

## Fix

**Reading** — select the projected fields *and* expand the relation:

```http
GET …/items?$select=Id,Title,Owner/Title,Owner/EMail&$expand=Owner
```

**Writing** — set the foreign key, not the entity:

```ts
body: JSON.stringify({ OwnerId: 14 })   // SP integer user id — resolve via ensureuser
```

For person fields the integer comes from [`ensureuser`](../spfx/people-search-endpoints-that-work.md); for lookups it's the target item's `Id`.

## Notes

- SharePoint Online enforces a **lookup column threshold (~12 per query)** — every expanded lookup/person column (plus some system ones) counts. Wide queries over relation-heavy lists can fail outright; select only the relations you render.
- The `Id` suffix convention applies to multi-value lookup/person fields too, with array payloads — but test the exact shape against your OData mode before shipping.
- Filtering on expanded fields (`$filter=Owner/Title eq '…'`) works, but the [indexed-column rules](../lists/list-view-threshold-and-indexes.md) still apply on large lists.
