---
title: The tenant root site is not necessarily readable by everyone
summary: "Measured: unique permissions, no *Everyone except external users*, an ordinary employee's mask `High=0, Low=0`; don't anchor a must-work-for-everyone mechanism there, measure with `getusereffectivepermissions`"
tags: [permissions, security, rest-api, root-site]
applies-to: SharePoint Online
last-reviewed: 2026-09-24
---

# The tenant root site is not necessarily readable by everyone

> **Bottom line.** It is tempting to anchor something every user needs — a tenant-wide setting, a shared configuration, a lookup that decides whether a feature works at all — on the root site, because "everyone can read the root site". Not on every tenant: on the one we measured, the root web had unique permissions without *Everyone except external users*, and an ordinary employee's effective permissions there were zero. Anything that must work for every user must not depend on reading the root site; measure with an ordinary account before you build on it.
>
> **Ve zkratce.** Láká ukotvit na kořenovém webu něco, co potřebuje každý uživatel – nastavení pro celý tenant, sdílenou konfiguraci, dotaz, na kterém stojí, jestli funkce vůbec poběží –, protože „kořenový web přece čte každý“. Ne na každém tenantu: na tom, který jsme měřili, měl kořenový web vlastní oprávnění bez *Everyone except external users* a efektivní práva běžného zaměstnance tam byla nulová. Co musí fungovat každému uživateli, nesmí záviset na čtení kořenového webu; než na tom začneš stavět, změř to běžným účtem.

## Symptom

Nothing, as long as you test with an account that administers the root site — it can read it on every tenant, so the feature works in every test. The first ordinary user of a tenant with a locked-down root site is refused on `/_api/site` or `/_api/web` of the root, and the feature behaves as if it had never been set up.

## Cause

The root site is an ordinary site collection with ordinary permissions, and nothing guarantees that employees can read it. On the tenant we measured:

```
GET https://contoso.sharepoint.com/_api/web?$select=HasUniqueRoleAssignments
→ { "HasUniqueRoleAssignments": true }

GET https://contoso.sharepoint.com/_api/web/roleassignments?$expand=Member
→ no Everyone-except-external-users claim (c:0-.f|rolemanager|spo-grid-all-users/…) among the principals

GET https://contoso.sharepoint.com/_api/web/getusereffectivepermissions(@u)?@u='i%3A0%23.f%7Cmembership%7Cmegan%40contoso.com'
→ { "High": "0", "Low": "0" }      // no rights at all
```

The last call is the one that decides. The claim can also sit inside an ordinary SharePoint group, so a missing direct role assignment is a hint, not a verdict; the effective permissions of a real user are the verdict.

## Fix

- **Don't put a must-work-for-everyone mechanism on the root site.** Read what you need from the site the user is on, or from a location whose permissions you set and verify yourself.
- **Measure, don't assume.** `getusereffectivepermissions` resolves the mask for any user from your own admin session — see [Check another user's effective permissions](../../snippets/rest/check-another-users-effective-permissions.md). `High = 0, Low = 0` is an unambiguous "no".
- **Don't paper over it with a fallback to something anyone can read.** If a protection falls back to a publicly readable value whenever the protected read fails, it protects nothing — whoever wants past it simply takes the fallback path.

## Notes

- To find where the tenant-wide claims *are* granted — directly or inside a group — see [Get-EveryoneClaimReport.ps1](../../scripts/permissions/Get-EveryoneClaimReport.ps1).
