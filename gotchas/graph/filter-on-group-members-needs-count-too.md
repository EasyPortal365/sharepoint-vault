---
title: "$filter on /groups/{id}/members needs $count=true, not just ConsistencyLevel"
tags: [graph-api, groups, odata]
applies-to: Microsoft Graph v1.0 (delegated and app-only)
last-reviewed: 2026-07-28
---

# `$filter` on `/groups/{id}/members` needs `$count=true`, not just `ConsistencyLevel`

> **Bottom line.** Filtering a directory navigation collection needs the *pair* `ConsistencyLevel: eventual` **and** `$count=true` — sending only the header still returns `400 Request_UnsupportedQuery`, and a best-effort `catch` around it will quietly disguise a permanently broken call as an intermittent outage.
>
> **Ve zkratce.** Filtrování navigační kolekce adresáře vyžaduje **dvojici** `ConsistencyLevel: eventual` **a** `$count=true` – se samotnou hlavičkou dostaneš dál `400 Request_UnsupportedQuery`, a best-effort `catch` kolem toho udělá z trvale rozbitého volání zdánlivě občasný výpadek.

## Symptom

A panel that offers "remove only the guests from this group" always says guests could not be loaded — with wording like *"temporary Graph outage, try again later"*. It looks like throttling. It isn't: the call fails **every time, for every group**, and has done so since the code was written.

```
GET /groups/{id}/members/microsoft.graph.user?$filter=userType eq 'Guest'&$select=id,displayName&$top=100
ConsistencyLevel: eventual

400 Request_UnsupportedQuery
"The specified filter to the reference property query is currently not supported."
```

## Cause

`/groups/{id}/members` is a **reference (navigation) property**, not a resource collection. `$filter` over it requires Graph's *advanced query capabilities*, which are enabled by **two things together**:

- the request header `ConsistencyLevel: eventual`, **and**
- the query parameter `$count=true`

Send only the header and you still get `400`. That is what makes this one stick around: the code *looks* correct — someone clearly knew about `ConsistencyLevel` — so reviewers skim past it. A sibling method that happened to include `$count=true` (because it wanted a count anyway) works fine, so parts of the app report guest **numbers** correctly while the guest **list** never loads.

Measured live against two groups on the same tenant:

| variant | result |
|---|---|
| `$filter` alone | ❌ 400 `Request_UnsupportedQuery` |
| `$filter` + `ConsistencyLevel: eventual` | ❌ 400 `Request_UnsupportedQuery` |
| `$filter` + `ConsistencyLevel: eventual` + `$count=true` | ✅ 200 |
| no `$filter`; select `userType` and filter client-side | ✅ 200 |

Note this is **independent** of the other well-known trap on directory collections — `$select` of user-only fields failing on the `directoryObject` base type, which an OData cast (`/members/microsoft.graph.user`) fixes. The cast does nothing for `$filter`. Two separate problems on the same URL; fixing one does not fix the other.

## Fix

If you only need a count or a read-only display, add the missing half:

```http
GET /groups/{id}/members/microsoft.graph.user?$filter=userType eq 'Guest'&$count=true&$top=100
ConsistencyLevel: eventual
```

If the result **drives a destructive action** (removing those members), prefer reading without a filter and deciding client-side:

```ts
// one page shown; follow @odata.nextLink to completion
const res = await client
  .api(`/groups/${groupId}/members/microsoft.graph.user?$select=id,displayName,userType&$top=100`)
  .get();
const guests = (res.value ?? []).filter(u => u.userType === 'Guest');
```

You usually pay nothing for this — the caller normally loads the roster anyway — and you stop trusting a server-side boolean filter for something that deletes data.

## Notes

- **A best-effort `catch` turns a permanently broken path into a phantom "outage".** The fallback here was designed for a transient failure but received a deterministic one, so the UI confidently told users a cause that was false. If a fallback shows text, it must not assert a cause it did not verify — say "couldn't load", not "temporary outage".
- **Best-effort paths need to be probed on purpose once in a while.** Nothing about a silently degraded feature ever surfaces as an error; it just looks like the product does less than you thought. One four-line A/B query in the browser console settles it.
- Same rule applies to `/groups/{id}/owners`, `/users/{id}/memberOf`, `/servicePrincipals/{id}/appRoleAssignedTo` and other navigation collections.
