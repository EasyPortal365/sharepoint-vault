---
title: directoryObject collections reject `$select` of user fields — and `$top` is a separate, per-endpoint trap
tags: [graph, odata, directory, paging, troubleshooting]
applies-to: Microsoft Graph (v1.0 and beta)
last-reviewed: 2026-07-24
---

# directoryObject collections reject `$select` of user fields — and `$top` is a **separate**, per-endpoint trap

> **Bottom line.** On heterogeneous directoryObject collections (`/members`, `/memberOf`, `/owners`, `/transitiveMembers`), `$select=displayName,userPrincipalName,…` returns **HTTP 400** because the base type only has `id`. An **OData cast** (`/members/microsoft.graph.user`) fixes that everywhere — but it does **not** unlock `$top`, which some endpoints refuse independently (`/directoryRoles/{id}/members` → `400 Request_UnsupportedQuery`). Both are runtime-only: your compiler and linter pass, the call fails in production.
>
> **Ve zkratce.** U heterogenních directoryObject kolekcí (`/members`, `/memberOf`, `/owners`, `/transitiveMembers`) vrátí `$select` user-polí **HTTP 400** — bázový typ má jen `id`. **OData cast** (`/members/microsoft.graph.user`) tuhle past odstraní všude, ale **neodemkne `$top`**, který některé endpointy odmítají nezávisle (`/directoryRoles/{id}/members` → `400 Request_UnsupportedQuery`). Obojí selže až za běhu — kompilátor ani linter to nechytí.

## Symptom

A directory report (privileged roles, group members, a user's group membership) fails **entirely** and your fail-safe shows "couldn't load". Other Graph calls in the same app work, so the token clearly has the scope. Two distinct failures hide here, and fixing the first reveals the second:

```
400  Could not find a property named 'userPrincipalName' on type 'Microsoft.DirectoryServices.DirectoryObject'
400  Request_UnsupportedQuery: This resource does not support custom page sizes. Please retry without a page size argument.
```

The second one is nastier: with a per-item `try/catch` it degrades into "0 members found" rather than an error, so the UI shows an empty — and entirely believable — report.

## Cause

`/members`, `/memberOf`, `/owners` and `/transitiveMembers` return **directoryObject**, a base type carrying only `id` (+ `deletedDateTime`). Users, groups and service principals are *derived* types. Selecting a derived-type property on a base-type collection is invalid OData → 400.

`$top` is unrelated: certain endpoints simply do not accept a caller-supplied page size and paginate on their own terms via `@odata.nextLink`.

## Fix

**Use an OData cast when you know which type you want** — it filters to that type *and* re-enables `$select`:

```http
GET /groups/{id}/transitiveMembers/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName
GET /users/{id}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName,groupTypes,securityEnabled
```

**Read the bare endpoint when you need the mix** (users *and* nested groups in one response) — no `$select` at all, then branch on `@odata.type` in your mapper:

```http
GET /directoryRoles/{id}/members
```

**Always follow `@odata.nextLink`** and treat `$top` as an optimisation you must prove per endpoint, never assume.

## Probe before you ship

The two traps are independent, so verifying one tells you nothing about the other. Four calls settle it — measured results from a live tenant:

| Endpoint | bare | cast + `$select` | cast + `$select` + `$top` |
|---|---|---|---|
| `/users/{id}/transitiveMemberOf` → `/microsoft.graph.group` | ✅ | ✅ | **✅ 200** |
| `/groups/{id}/transitiveMembers` → `/microsoft.graph.user` | ✅ | ✅ | **✅ 200** |
| `/directoryRoles/{id}/members` → `/microsoft.graph.user` | ✅ | ✅ | **❌ 400** |

So: **cast cures `$select` everywhere; `$top` is a property of the individual endpoint.** Do not generalise from one endpoint to its neighbours — run the probe.

## Notes

- Neither failure is visible to TypeScript or ESLint — these are runtime OData validations. Only a live call finds them.
- Make fail-safe handlers surface the **real** `GraphError` (status + `code` + `message`). A catch that reports a generic "missing permission" guess sends you hunting consent for hours while the actual message names the property or the page size.
- Per-item `try/catch` in a fan-out (one role fails → skip that role) is good for resilience but will *mask* a systematic 400 across every item. When a report returns suspiciously empty, re-run one item without the catch.
- Related: [MSGraphClient calls bypass DevTools' network tab](msgraphclient-calls-bypass-devtools-network.md) — which is why these 400s are easiest to read from inside the app itself.
