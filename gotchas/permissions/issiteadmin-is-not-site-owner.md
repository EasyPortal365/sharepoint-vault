---
title: "IsSiteAdmin is not \"site owner\": gating on it locks out the people who actually configure the site"
short-title: IsSiteAdmin is not "site owner"
summary: "`siteusers` IsSiteAdmin is true only for site collection admins; a site owner with Full Control through the Owners group reads false, a tenant admin whose admin rights come from a role claim (Global/SharePoint Administrator) reads false too, and on a group-connected team site the owners are a single Microsoft 365 group claim you cannot expand over REST – treat 'admin' as SCA or direct Owners member, and a nested principal or a role claim as 'unknown', never as 'not an admin'"
tags: [permissions, rest-api, site-groups, security]
applies-to: SharePoint Online
last-reviewed: 2026-11-17
---

# IsSiteAdmin is not "site owner": gating on it locks out the people who actually configure the site

> **Bottom line.** A check like "was this setting saved by an administrator of the site?" is often written as "is the editor's `IsSiteAdmin` true?". That is only the site collection admin. The site owner – the person who normally saves app settings – has Full Control through the Owners group and reads `IsSiteAdmin: false`. On a group-connected team site the Owners group holds one Microsoft 365 group claim instead of people. Count direct members of the Owners group as admins too, and when the group contains a nested principal, return "unknown" and do not block. A tenant admin whose rights come from a role claim also reads `false`, even though `currentuser` says `true` for them.
>
> **Ve zkratce.** Kontrola „uložil toto nastavení správce webu?“ se často píše jako „má autor `IsSiteAdmin`?“. To je ale jen správce kolekce webů. Vlastník webu, který nastavení appek běžně ukládá, má Úplné řízení přes skupinu Vlastníci a `IsSiteAdmin: false`. Na týmovém webu se skupinou Microsoft 365 je ve Vlastnících místo lidí jeden claim skupiny. Za správce počítej i přímé členy skupiny Vlastníci. Když skupina obsahuje vnořený principal, vrať „neznámo“ a neblokuj. Správce tenantu, který práva má přes roli, má v `siteusers` také `false`, i když mu `currentuser` vrací `true`.

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

The same blind spot hits **tenant admins**. On the tenant app catalog (and on many sites created by admins) the site collection admins are often only role claims, not people:

```
GET <catalog>/_api/web/siteusers?$filter=IsSiteAdmin eq true&$select=LoginName,Title
→ [ { "LoginName": "c:0t.c|tenant|<role-id>", "Title": "Global Administrator" },
    { "LoginName": "c:0t.c|tenant|<role-id>", "Title": "SharePoint Administrator" } ]

GET <catalog>/_api/web/currentuser?$select=Id,IsSiteAdmin      // signed in as a SharePoint admin
→ { "Id": 10, "IsSiteAdmin": true }                              // effective: granted through the role

GET <catalog>/_api/web/siteusers/getbyid(10)?$select=IsSiteAdmin
→ { "IsSiteAdmin": false }                                        // stored flag on the user: false
```

`currentuser` reports the effective state; `siteusers` reports only the flag stored on that user. A reader cannot tell over SharePoint REST that the editor holds the role. So "was this item last edited by a site collection admin?" is **never** true there, even when a tenant admin wrote it. Writing a tenant property instead does not help from the browser either: `SetStorageEntity` returns 403 even to an admin, because the app catalog has custom scripts disabled.

## Fix

Resolve the editor's authority as three values, not two:

- **admin** – site collection admin (`IsSiteAdmin`) **or** a direct member of `AssociatedOwnerGroup`.
- **unknown** – no editor id, the Owners group cannot be read, or it contains any principal other than a user (`PrincipalType !== 1`: a Microsoft 365 group claim, a security group, a role claim).
- **other** – every owner is a user and the editor is none of them, nor a site collection admin.

Block only on **other**. Treat **unknown** as a soft state, for example a notice to the admin. Filter the user lists in your code; do not trust a server-side boolean `$filter` for permission decisions.

If the site collection admins include a role claim (`c:0t.c|tenant|…`), an editor who is not flagged may still be an admin through that role – that is **unknown**, not **other**.

Before you build a trust check on the editor at all, ask whether it adds anything. On the tenant app catalog, write access to the web normally goes only to the people trusted to manage solution packages there. A list that inherits the web's permissions is then writable by exactly those people. A check that the list and the item inherit permissions, plus a single-row rule, is what a reader can actually verify. Whether the web's write access is really that narrow can be checked only by an admin (role assignments), so show that result to the admin who sets the value.

Unit tests with a faked HTTP layer will not catch any of this: the fake returns whatever `IsSiteAdmin` you assumed. Run permission checks live, with a real tenant admin, before you ship them.

Test three site shapes:

- a root site whose settings were saved by a direct owner;
- a group-connected team site whose owners are only the group claim;
- a hub site.

## Related

- [Counting a site's audience from its associated groups silently misses nested groups](site-audience-from-associated-groups-misses-nested-groups.md)
- [An Entra group inside a SharePoint group is invisible to membership checks](../security/entra-group-inside-a-sharepoint-group-is-invisible-to-membership-checks.md)
