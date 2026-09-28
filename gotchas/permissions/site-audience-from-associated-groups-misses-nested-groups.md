---
title: Counting a site's audience from its associated groups silently misses nested groups
summary: "Owners/Members/Visitors often contain *Everyone except external users* or the Microsoft 365 group claim (PrincipalType 4); keeping only PrincipalType 1 rows turns a whole company into one or two people – treat any nested group as 'audience unknown'"
tags: [permissions, rest-api, site-groups, read-receipts]
applies-to: SharePoint Online
last-reviewed: 2026-09-28
---

# Counting a site's audience from its associated groups silently misses nested groups

> **Bottom line.** A "who has not read this yet" list or a "12 of 48 have read it" figure needs the size of the site's audience. Reading the users of the Owners and Members groups looks like the answer, but on a typical communication site the employees are in Visitors through *Everyone except external users*, and on a group-connected team site the members sit behind the Microsoft 365 group claim. Both are a single row with `PrincipalType` 4. Filter to `PrincipalType 1` and the audience of a company-wide portal becomes the one site owner. If any associated group contains a group, the audience is unknown – say so instead of showing a list built from the direct members.
>
> **Ve zkratce.** Seznam „kdo ještě nečetl“ nebo údaj „přečetlo 12 z 48“ potřebuje velikost publika webu. Čtení uživatelů skupin Vlastníci a Členové vypadá jako odpověď. Na běžném komunikačním webu jsou ale zaměstnanci v Návštěvnících přes *Everyone except external users* a na týmovém webu se skupinou Microsoft 365 stojí členové za claimem skupiny. Obojí je jediný řádek s `PrincipalType` 4. Kdo nechá jen `PrincipalType 1`, zmenší publikum celofiremního portálu na jednoho vlastníka webu. Obsahuje-li kterákoli přidružená skupina skupinu, je publikum neznámé – řekni to, místo seznamu z přímých členů.

## Symptom

A read-receipt feature on an intranet home page shows "Not read (1)" and "1 of 1 have read it" on a portal that the whole company reads. Nothing errors; the numbers are simply small and look plausible to whoever tests with a handful of accounts.

## Cause

The associated groups hold principals, not only people:

```
GET /sites/portal/_api/web/AssociatedOwnerGroup/Users?$select=Title,Email,PrincipalType
→ [ { "PrincipalType": 1, ... } ]                       // one owner

GET /sites/portal/_api/web/AssociatedMemberGroup/Users?$select=Title,Email,PrincipalType
→ [ ]

GET /sites/portal/_api/web/AssociatedVisitorGroup/Users?$select=Title,Email,PrincipalType,LoginName
→ [ { "PrincipalType": 4,
      "LoginName": "c:0-.f|rolemanager|spo-grid-all-users/<tenant-guid>" } ]   // Everyone except external users
```

`PrincipalType`: 1 = user, 2 = distribution list, 4 = security group (including the tenant-wide claims and the Microsoft 365 group claim `c:0o.c|federateddirectoryclaimprovider|<group-guid>`), 8 = SharePoint group. The code that kept only `PrincipalType 1` rows and read only Owners and Members produced an audience of one.

## Fix

- **Read all three associated groups** – Owners, Members and Visitors. Visitors is where communication sites put their readers.
- **Any row with `PrincipalType` other than 1 makes the audience unknown.** Return an explicit "unknown" with a reason (a nested group, or no group readable), not a partial list. The UI then hides "not read" and percentages and says why. The list of people who *did* confirm stays accurate, because it comes from the receipts themselves.
- **Don't try to expand *Everyone except external users* into a list of people.** It means every internal account, including shared mailboxes and service accounts. A Microsoft 365 group can be expanded with Graph (`/groups/{id}/transitiveMembers`), but that needs a Graph permission such as `GroupMember.Read.All`. That's a product decision, not a quiet fallback.
- **Test on a site set up like production.** A test site where you added three people directly to Members hides the whole problem.

## Notes

- The same trap applies to anything that divides by "site members": completion rates, "X of Y acknowledged", "everyone has seen it" badges.
- `$top=5000` on the group users call is still worth keeping: a group with thousands of directly added users exists too.
