---
title: GetObjectSharingInformation — GET always 405, CreatedBy always null, and other measured facts
tags: [rest-api, sharing, permissions, performance]
applies-to: SharePoint Online
last-reviewed: 2026-08-08
---

# GetObjectSharingInformation — GET always 405, CreatedBy always null, and other measured facts

> **Bottom line.** This endpoint is the only practical way to enumerate sharing links per file from a browser, but three of its documented-looking behaviours do not hold. Measured on a live tenant with delegated (signed-in admin) access, 2026-08-08.

## What it is

```
POST <web>/_api/web/GetList('<server-relative-list-url>')/items(<id>)/GetObjectSharingInformation
```

Returns `SharingLinks` (every link ever created on the item) and `SharedWithUsersCollection`. It is per item, so auditing a library means one call per candidate file — the cost characteristics below matter.

## Trap 1 — GET is rejected every time, so stop asking

The endpoint is a method, and guidance commonly suggests "try GET, fall back to POST". On SPO today **GET returns 405, always**. Code that retries GET per item pays two round-trips for every file and learns nothing:

| items | GET-then-POST per item | POST only |
|---|---|---|
| 3 | 1 578 ms | 587 ms |

That is 2.7×. On a library with a hundred shared files it is the difference between half a minute and a minute and a half.

**Fix:** remember the rejection for the rest of the run.

```ts
private getRejected = false;

private async sharingInfo(base: string, itemId: number) {
  const url = base + '/items(' + itemId + ')/GetObjectSharingInformation';
  if (this.getRejected) return await spPost(url, {});
  try {
    return await spGet(url);
  } catch (e) {
    if (isStatus(e, 400) || isStatus(e, 404) || isStatus(e, 405)) {
      this.getRejected = true;            // ← the whole fix
      return await spPost(url, {});
    }
    throw e;
  }
}
```

## Trap 2 — `CreatedBy` is null, including on active links

The field exists in the payload and is `null` for every link, active or not. Tested with `$expand=SharingLinks,SharedWithUsersCollection`, `$expand=SharingLinks/CreatedBy`, both together, and with no `$expand` at all — `null` in all four.

So a "Created by" column built on this endpoint is permanently empty. Either omit it, or — better, since another tenant may behave differently — render it only when at least one row actually carries a value, and otherwise say where the information does live (the unified audit log records the sharing operation and its actor).

## Trap 3 — `$expand` is not needed

`SharingLinks` comes back whether or not you expand it. The `$expand` in most published snippets is dead weight.

## Trap 4 — filter out `IsActive: false`

Every item carries template rows for link types that were never created. Counting them reports links that do not exist. Filter on `IsActive === true` before anything else.

## Trap 5 — `Scope` is uninitialised

`Scope` arrives as `-1` rather than the documented enum, so anonymity cannot be derived from it. Use `AllowsAnonymousAccess` and `LinkKind` instead (`LinkKind` 4/5 = anonymous view/edit, 2/3 = organisation view/edit, 1 = direct permission rather than a link).

## Narrowing the candidate set

Calling this for every item in a library is wasteful. Items that were never shared can be skipped by selecting `SharedWithUsersId` first and only calling the endpoint for items where it is non-empty. **Check that the field is actually returned** — if it is absent from the list, the projection silently omits it and every item looks unshared, which is the same failure mode as a filter that quietly returns nothing.

## See also

- [Unknown managed properties fail silently](../search/unknown-managed-properties-fail-silently.md) — a quiet empty result that reads as a fact
