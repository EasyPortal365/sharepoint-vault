---
title: Check another user's effective permissions (without their password)
tags: [rest-api, security, permissions, auditing]
applies-to: SharePoint Online
last-reviewed: 2026-07-29
---

# Check another user's effective permissions — without signing in as them

> **Bottom line.** `getusereffectivepermissions` returns the resolved permission mask for **any** user, so you can verify "will a normal employee actually be able to read this?" from your own admin session — no test account, no password sharing.
>
> **Ve zkratce.** `getusereffectivepermissions` vrátí výslednou masku oprávnění pro **libovolného** uživatele, takže si z vlastní admin session ověříš „dostane se sem běžný zaměstnanec?" – bez testovacího účtu a bez sdílení hesla.

## Why you want this

Admins see everything, so any feature tested only by an admin looks fine. The question that actually matters — *does this work for someone with ordinary rights?* — normally needs a second account. It doesn't.

Typical uses: confirming a site is readable before making an app depend on it, auditing who really has access after inheritance was broken, checking a permission change did what you meant.

## The call

```
GET /_api/web/getusereffectivepermissions(@u)?@u='i:0%23.f|membership|user@contoso.com'
Accept: application/json;odata=nometadata

→ { "High": "432", "Low": "1011030767" }
```

The parameter is the **login name** (claims format), URL-encoded — note `#` must become `%23`. Wrap it in single quotes; double any apostrophe inside the login before encoding, since `encodeURIComponent` leaves `'` alone.

```js
const login = "i:0#.f|membership|user@contoso.com";
const url = `${webUrl}/_api/web/getusereffectivepermissions(@u)?@u='${encodeURIComponent(login.replace(/'/g, "''"))}'`;
const perms = await (await fetch(url, { headers: { Accept: 'application/json;odata=nometadata' } })).json();
```

To enumerate candidates first: `GET /_api/web/siteusers?$select=Title,LoginName,IsSiteAdmin,PrincipalType` (`PrincipalType === 1` is a user).

## Decoding the mask — the part that trips people up

The result is a **64-bit mask split across two 32-bit halves**, returned as strings. `High = "0", Low = "0"` means no rights at all — the cleanest possible answer.

For individual rights, mind which half a bit lives in. `Open` (the right to even open the web) is **`Low` bit 16 / `0x10000`** — not `High` bit 0, which is an easy and wrong guess:

```js
const hi = parseInt(perms.High, 10);
const lo = parseInt(perms.Low, 10) >>> 0;

const none          = hi === 0 && lo === 0;
const open          = (lo & 0x10000)  !== 0;   // SPBasePermissions.Open
const viewPages     = (lo & 0x20000)  !== 0;   // SPBasePermissions.ViewPages
const viewListItems = (lo & 0x1)      !== 0;   // SPBasePermissions.ViewListItems
const addListItems  = (lo & 0x2)      !== 0;   // SPBasePermissions.AddListItems
const editListItems = (lo & 0x4)      !== 0;   // SPBasePermissions.EditListItems
```

## Check the right you actually depend on — including *write*

The question users really ask is rarely "can they open it?" but "will their **Save** work?". An app decides whether to draw an Edit button from its own rules, while the write itself lives or dies on the list permission — and those two drift apart (someone was granted an app role but never landed in the SharePoint group that carries write access). Point the call at the list and test `AddListItems`/`EditListItems`:

```
GET /_api/web/GetList(@l)/getusereffectivepermissions(@u)
    ?@l='/sites/team/Lists/Products'&@u='i%3A0%23.f%7Cmembership%7Cuser@contoso.com'
```

Resolve the list by URL rather than by title so a rename doesn't break the check. Reporting the *mismatch* ("they will see Edit but the save will fail") is far more useful than reporting the raw mask.

Beware of partial rights: a user can hold `Open` (inherited via *Limited Access*) while lacking `ViewPages` and `ViewListItems` — enough to look "permitted" in a naive check and still fail every real request. Test the specific right you depend on, not merely a non-zero mask.

## Related

Use it alongside a look at where the permissions come from:

```
GET /_api/web?$select=Title,HasUniqueRoleAssignments
GET /_api/web/roleassignments?$expand=Member,RoleDefinitionBindings
```

If `HasUniqueRoleAssignments` is true and the assignments don't include *Everyone except external users*, don't assume ordinary users can read that web — a surprising number of tenants have a locked-down root site.
