---
title: There is no sitegroups/removebyname — delete a group by Id
tags: [rest-api, groups, permissions, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-24
---

# There is no `sitegroups/removebyname` — delete a group by Id

> **Bottom line.** `GroupCollection` has `GetByName` (read) but **no `RemoveByName`**. To delete a group when you only know its name, resolve the Id with `getbyname` first, then `POST .../sitegroups/removebyid(<id>)`.
>
> **Ve zkratce.** `GroupCollection` má `GetByName` (čtení), ale **`RemoveByName` NE**. Když znáš jen jméno skupiny, nejdřív si přes `getbyname` zjisti Id a teprve pak `POST .../sitegroups/removebyid(<id>)`.

## Symptom

Code deletes a site group by posting to a name-based endpoint:

```
POST /_api/web/sitegroups/removebyname('My Group')
```

The call returns without throwing, but the **group is still there** — a follow-up `getbyname('My Group')` keeps returning it (same Id, only the `updated` timestamp moves). If the failure is swallowed (`return resp.ok` inside a try/catch), nothing surfaces in the UI: the surrounding action looks like it succeeded.

## Cause

`SP.GroupCollection` exposes `GetById`, `GetByName`, `Add`, and — for removal — only **`RemoveById(id)`** (plus `RemoveByLoginName`, which removes a *user* from a group, not a group). **`RemoveByName` does not exist.** The read method `GetByName` tempts you into assuming a symmetric `RemoveByName`; there is none, so SharePoint rejects the call with a non-2xx status and the group survives.

## Fix

Resolve the Id, then remove by Id:

```ts
// 1. name -> Id
const g = await sp.get(
  `${web}/_api/web/sitegroups/getbyname('${encodeURIComponent(name)}')?$select=Id`, ...);
if (g.status === 404) return true;              // already gone = done (idempotent)
if (!g.ok) return false;
const { Id } = await g.json();

// 2. delete by Id (POST needs a fresh X-RequestDigest)
const res = await sp.post(
  `${web}/_api/web/sitegroups/removebyid(${Id})`,
  { headers: { 'X-RequestDigest': digest, ... }, body: '' });
return res.ok;
```

## Notes

- **`getbyname` (GET) working is not proof that `removebyname` (POST) exists** — the read and write method sets differ on the same collection. Check the actual `GroupCollection` methods, don't infer a delete endpoint from the read one.
- A REST endpoint is just a string; TypeScript won't flag a non-existent method name. The only safety net is a live smoke test that **verifies the resulting state** (`getbyname` → 404), not merely that the request came back. "Save succeeded" ≠ "the delete happened."
- The `POST` to `removebyid` needs a valid `X-RequestDigest`; a stale page digest 403s after ~30 min (see [request-digest-expires-mid-session](request-digest-expires-mid-session.md)).
- Deleting a group is destructive and requires **Manage Permissions** (site owner / Full Control); a Contributor gets 403.
