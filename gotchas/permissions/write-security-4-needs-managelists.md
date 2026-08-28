---
title: "A list with WriteSecurity 4 ignores Contribute — only ManageLists gets through"
tags: [permissions, lists, rest-api, roles, governance]
applies-to: SharePoint Online
last-reviewed: 2026-08-28
---

# A list with WriteSecurity 4 ignores Contribute — only ManageLists gets through

> **Bottom line.** `WriteSecurity = 4` on a list means "users cannot modify any items", and the only thing that overrides it is the **ManageLists** permission — which `Contribute` does **not** include. So the obvious fix, "break inheritance and give the group Contribute on that list", changes nothing: the group still gets 403 on write. Grant a role that carries ManageLists (**Design**, RoleTypeKind 4) instead, and resolve it by **type**, never by its localised name.
>
> **Ve zkratce.** `WriteSecurity = 4` znamená „položky nesmí měnit nikdo" a obchází to jedině oprávnění **ManageLists**, které `Contribute` NEMÁ. Očividná oprava „rozbij dědičnost a dej skupině Contribute" tedy nefunguje — skupina dál dostane 403. Přiděl roli s ManageLists (**Návrh**, RoleTypeKind 4) a hledej ji podle TYPU, ne podle lokalizovaného názvu.

## Symptom

You want one group — say the people who maintain the company branding — to edit exactly one hidden configuration list, without giving them anything else on the site.

You add them to a SharePoint group, break inheritance on the list, grant the group **Contribute**, and the app still fails to save. The Save button is enabled (the app has no way to know), and the write comes back **403**. An administrator testing the same screen sees it work perfectly, because administrators have ManageLists everywhere.

## Cause

`WriteSecurity` is the list's *item-level* write restriction:

| Value | Meaning |
|---|---|
| 1 | All users can modify all items |
| 2 | Users can modify only items they created |
| 4 | Users cannot modify any items |

The restriction is bypassed by users who hold **ManageLists** on that list. Among the built-in roles, ManageLists is carried by **Design**, **Edit** and **Full Control** — but *not* by **Contribute**. Granting Contribute therefore grants nothing that the item-level setting does not immediately take away again.

## Fix

Break inheritance on that one list and assign a role definition that carries ManageLists — Design is the least privileged of them:

```js
// Role definitions are LOCALISED ("Design" / "Návrh" / "Entwerfen") — resolve by type.
// RoleTypeKind: 2 Reader · 3 Contributor · 4 WebDesigner · 5 Administrator · 6 Editor
const rd = await get(`${web}/_api/web/roledefinitions/getbytype(4)?$select=Id`);
const gid = await get(`${web}/_api/web/sitegroups/getbyname('${literal}')?$select=Id`);

await post(`${listApi}/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)`);
await post(`${listApi}/roleassignments/addroleassignment(principalid=${gid},roledefid=${rd})`);
```

Two details that decide whether this is correct or a hole:

* **`copyRoleAssignments` depends on what you are protecting.** When you break inheritance to *hide* content, copying is a trap: it brings along every group that had Edit on the web, and Edit carries ManageLists, which walks straight through item-level security. When you break inheritance only to *widen writing* on a list everyone is meant to read, copying is right — dropping the copied assignments would take reading away from everyone else.
* **Verify by reading the state back**, not by trusting the response codes, and only then remember "done". Both calls need `ManagePermissions`, so an ordinary member silently achieves nothing; a marker written on the strength of a 200 would freeze that state forever.

## Say it out loud in the UI

Until the permission step has actually run, the role cannot write. The screen should admit that rather than offering a button that will fail — an enabled control that always 403s is worse than a disabled one, because the user blames themselves.

## See also

* [Item-level permission defaults on provisioned lists](../lists/item-level-permissions-defaults-on-provisioned-lists.md) — where these `ReadSecurity`/`WriteSecurity` values come from in the first place
