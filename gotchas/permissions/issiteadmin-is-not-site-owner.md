---
title: "IsSiteAdmin is not \"site owner\": gating on it locks out the people who actually configure the site"
short-title: IsSiteAdmin is not "site owner"
summary: "`siteusers` IsSiteAdmin is true only for site collection admins; a site owner with Full Control through the Owners group reads false, and on a group-connected team site the owners are a single Microsoft 365 group claim you cannot expand over REST – treat 'admin' as SCA or direct Owners member, and a nested principal as 'unknown', never as 'not an admin'"
tags: [permissions, rest-api, site-groups, security]
applies-to: SharePoint Online
last-reviewed: 2026-11-17
---

# IsSiteAdmin is not "site owner": gating on it locks out the people who actually configure the site

> **Bottom line.** A check like "was this setting saved by an administrator of the site?" is often written as "is the editor's `IsSiteAdmin` true?". That is only the site collection admin. The site owner – the person who normally saves app settings – has Full Control through the Owners group and reads `IsSiteAdmin: false`. On a group-connected team site the Owners group holds one Microsoft 365 group claim instead of people. Count direct members of the Owners group as admins too, and when the group contains a nested principal, return "unknown" and do not block.
>
> **Ve zkratce.** Kontrola „uložil toto nastavení správce webu?“ se často píše jako „má autor `IsSiteAdmin`?“. To je ale jen správce kolekce webů. Vlastník webu, který nastavení appek běžně ukládá, má Úplné řízení přes skupinu Vlastníci a `IsSiteAdmin: false`. Na týmovém webu se skupinou Microsoft 365 je ve Vlastnících místo lidí jeden claim skupiny. Za správce počítej i přímé členy skupiny Vlastníci. Když skupina obsahuje vnořený principal, vrať „neznámo“ a neblokuj.

## Symptom

A security gate that switches a feature off when its configuration was "not saved by an admin" switches it off on the root site of the tenant. The configuration there was saved by the site owner. Nothing errors; the feature just reports that it is unavailable.

## Cause

```
GET /_api/web/siteusers?$select=Id,IsSiteAdmin
→ { "Id": 12, "IsSiteAdmin": false }          // the site owner who saved the row (EditorId 12)

GET /_api/web/AssociatedOwnerGroup/Users?$select=Id,PrincipalType
→ [ { "Id": 12, "PrincipalType": 1 } ]         // ...is a direct member of Owners
```

On a group-connected team site:

```
GET /sites/team/_api/web/AssociatedOwnerGroup/Users?$select=Id,PrincipalType,LoginName
→ [ { "PrincipalType": 4, "LoginName": "c:0o.c|federateddirectoryclaimprovider|<group-guid>" },
    { "PrincipalType": 1, "LoginName": "SHAREPOINT\\system" } ]
```

The group owners sit behind that claim. SharePoint REST does not expand it; you would need Graph (`/groups/{id}/owners`) and a permission your app may not have.

## Fix

Resolve the editor's authority as three values, not two:

- **admin** – site collection admin (`IsSiteAdmin`) **or** a direct member of `AssociatedOwnerGroup`.
- **unknown** – no editor id, the Owners group cannot be read, or it contains any principal other than a user (`PrincipalType !== 1`: a Microsoft 365 group claim, a security group, a role claim).
- **other** – every owner is a user and the editor is none of them, nor a site collection admin.

Block only on **other**. Treat **unknown** as a soft state, for example a notice to the admin. Filter the user lists in your code; do not trust a server-side boolean `$filter` for permission decisions.

Test three site shapes:

- a root site whose settings were saved by a direct owner;
- a group-connected team site whose owners are only the group claim;
- a hub site.

## Related

- [Counting a site's audience from its associated groups silently misses nested groups](site-audience-from-associated-groups-misses-nested-groups.md)
- [An Entra group inside a SharePoint group is invisible to membership checks](../security/entra-group-inside-a-sharepoint-group-is-invisible-to-membership-checks.md)
