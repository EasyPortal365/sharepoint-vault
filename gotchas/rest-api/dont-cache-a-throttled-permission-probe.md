---
title: A throttled permission probe must not downgrade — and cache — the role
tags: [rest-api, spfx, permissions, throttling]
applies-to: SharePoint Online (client-side role resolution)
last-reviewed: 2026-07-23
---

# A throttled permission probe must not downgrade — and cache — the role

> **Bottom line.** Resolving a user's role from `/_api/web/currentuser/groups` (plus `IsSiteAdmin`) and caching it is fine — until that call is throttled (429) or forbidden (403), your code reads "no groups" as "not privileged", resolves the lowest role, and the cache pins the user there for the whole TTL. Only persist a role when the probe actually returned 200; on failure, degrade for this render but never cache it.
>
> **Ve zkratce.** Odvodit roli z `/_api/web/currentuser/groups` (a `IsSiteAdmin`) a zacachovat ji je v pořádku – dokud ten dotaz neškrtne 429 nebo 403, kód nepřečte „žádné skupiny" jako „bez oprávnění", nespadne na nejnižší roli a cache uživatele v ní nezamkne na celé TTL. Cachuj roli jen když probe vrátil 200; při selhání degraduj jen pro tento render, ale nikdy to neukládej.

## Symptom

An admin or editor intermittently loses their toolbar/menu — the app renders them as a read-only visitor — and it **stays** that way for tens of minutes, surviving reloads, then heals itself. Often correlated with many users behind one corporate NAT, or a burst of parallel calls at app start.

## Cause

Client-side role resolution usually does two calls — `/_api/web/currentuser?$select=IsSiteAdmin` and `/_api/web/currentuser/groups?$select=Title` — then maps group membership to a role, defaulting to the **lowest** role when neither privileged group matches. If the groups call is **throttled (429)** or **403s**, a naive implementation treats "no groups came back" as "not in any privileged group", resolves *visitor*, and then writes that to its cache (localStorage/sessionStorage) with, say, a 30-minute TTL. The user is now stuck at visitor until the cache expires — although nothing about their actual permissions changed. A transient network answer got frozen into a persisted decision.

## Fix

Distinguish "confirmed low privilege" from "couldn't tell", and only cache the confirmed case:

```ts
const [userResp, groupsResp] = await Promise.all([ /* IsSiteAdmin */, /* groups */ ]);
const confirmed = userResp.ok && groupsResp.ok;   // both actually returned 200
const role = resolveRole(userResp, groupsResp);    // may be 'visitor' on partial data
if (confirmed) cache.set(role, ttl);               // ...but persist ONLY when confirmed
setRole(role);                                     // use it for this render either way
```

- On a non-200 from either call, use a safe value for the current render but **don't persist it** — the next load retries and self-heals.
- Consider a short backoff/retry on 429 before assuming the lowest role at all.
- For *writes*, failing "closed" (don't grant edit on uncertain data) is correct — just don't remember the downgrade.

## Notes

- This is the auth-flavoured cousin of [silent fallbacks poison destructive writes](silent-fallbacks-poison-destructive-writes.md): `catch → default` is harmless for rendering, dangerous when the default is a **decision you then cache**.
- The cache key must include the web/site URL (two apps in one site collection resolve against different groups) and ideally the user — a shared key leaks one context's role into another.
- The same "don't cache uncertainty" rule applies to any capability probe (feature flags, license checks) whose negative answer might merely be a throttle. See also [rate limit counts the capability probe](../azure-functions/rate-limit-counts-capability-probe-corporate-nat.md).
