---
title: PATCH /me — directory and profile fields cannot share one request
tags: [graph, profiles, permissions]
applies-to: Microsoft Graph (Entra ID / Microsoft 365)
last-reviewed: 2026-07-16
---

# `PATCH /me`: directory and profile fields cannot share one request

> **Bottom line.** `PATCH /me` fronts two stores — Entra directory fields and profile-service fields — and one request mixing both groups is rejected wholesale, so split it into two PATCHes by field group.
>
> **Ve zkratce.** `PATCH /me` zastřešuje dvě úložiště – adresářová pole Entra a pole profilové služby – a jeden request, který obě skupiny míchá, se odmítne celý, takže ho rozděl na dva PATCHe podle skupiny polí.

## Symptom

A "My profile" form saves several fields at once:

```json
PATCH /me
{ "jobTitle": "Consultant", "city": "Brno", "aboutMe": "SharePoint since 2001", "skills": ["SPFx"] }
```

The whole request fails with:

> The request is currently not supported on the targeted entity set

Remove some fields and it suddenly works — add them back, it breaks again.

## Cause

`/me` fronts **two different stores**. Directory fields (`givenName`, `jobTitle`, `city`, `mobilePhone`, …) live in Entra ID; "profile" fields (`aboutMe`, `skills`, `interests`, `mySite`, …) live in the profile service. One PATCH mixing both groups is rejected wholesale — and the error message names neither the field nor the rule.

## Fix

**Two PATCHes**, split by field group — and treat the profile one as best-effort (it can fail independently without losing the directory save):

```ts
await graph.patch('/me', directoryFields);                 // jobTitle, city, …
try { await graph.patch('/me', profileFields); }           // aboutMe, skills, …
catch (e) { /* report, don't roll back the directory save */ }
```

## Notes

- **Self-service is narrower than you think:** with `User.ReadWrite`, a regular member can update only `mobilePhone`, their photo and password among directory fields. Editing `jobTitle`/`department`/etc. for *yourself* still requires an admin role (Global Admin, User Admin, Directory Writers) — check via `/me/transitiveMemberOf/microsoft.graph.directoryRole`.
- **Address-block fields won't budge even for admins** on the `User.ReadWrite` *scope* — the scope limits it, not the role. If your UI offers address editing, be ready to make it read-only rather than fight this.
- Field-group membership is documented on the [Update user](https://learn.microsoft.com/en-us/graph/api/user-update) page — when a mixed PATCH misbehaves, that's the table to consult.
