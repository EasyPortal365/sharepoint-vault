---
title: $filter on a multi-value person field can return 400 — filter those client-side
tags: [rest-api, fields, people]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# `$filter` on a multi-value person field can return 400 — filter those client-side

## Symptom

A query like

```http
GET …/items?$filter=Assignees/EMail eq 'megan@contoso.com'&$expand=Assignees
```

returns **HTTP 400** — and if your data layer swallows errors into an empty array, the feature backed by it just looks permanently empty.

## Cause

Filtering on projected fields of a **multi-value** person/lookup column (`UserMulti`) is not reliably supported by the list items endpoint. The same expression against a **single-value** person field works fine — which is exactly why the bug arrives late, when someone flips a column to "allow multiple selections".

## Fix

Degrade gracefully — try the server filter, fall back to client-side filtering **only on HTTP 400**:

```ts
try {
  return await getItems(`$filter=Assignees/EMail eq '${odataString(email)}'&$expand=Assignees&$select=…`);
} catch (e) {
  if (!isHttpStatus(e, 400)) { throw e; }               // real errors stay errors
  const all = await getItems(`$expand=Assignees&$select=…`);   // then filter in code
  return all.filter(i => (i.Assignees || []).some(a => a.EMail === email));
}
```

Keying the fallback to 400 specifically matters: a fallback on *any* error would mask outages and quietly serve stale/partial data.

## Notes

- Single-value person/lookup fields filter server-side without drama — don't blanket-move everything client-side.
- Client-side filtering pulls more rows; combine with a sensible `$top`/paging and the [indexed-column rules](../lists/list-view-threshold-and-indexes.md) on big lists.
