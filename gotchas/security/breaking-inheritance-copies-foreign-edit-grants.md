---
title: Breaking inheritance copies foreign Edit grants — and Edit defeats item-level security
tags: [security, permissions, lists, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-09-01
---

# Breaking inheritance copies foreign Edit grants — and Edit defeats item-level security

> **Bottom line.** `breakroleinheritance(copyRoleAssignments=true)` copies **every** web-level role assignment onto the list, including groups that some other application granted `Edit`. `Edit` carries `ManageLists`, which bypasses item-level security (`ReadSecurity = 2`) — so those users read everybody's "private" items. Break with `copyRoleAssignments=false` and grant the roles yourself, then remove anything that isn't on your allow-list.
>
> **Ve zkratce.** `breakroleinheritance(copyRoleAssignments=true)` zkopíruje na seznam **všechna** oprávnění z webu – včetně skupin, kterým dala `Edit` jiná aplikace. `Edit` nese `ManageLists`, což obchází item-level zabezpečení (`ReadSecurity = 2`), takže si tito lidé přečtou cizí „soukromé" položky. Lámej dědičnost bez kopírování a role si přiřaď sám; pak odeber vše, co není na bílé listině.

## Symptom

A list holds per-user private items. You set `ReadSecurity = 2` ("read only items the user created"), you broke inheritance, you even demoted **Site Members** from `Edit` to `Contribute` — and your security report *still* says the list is exposed. Listing the role assignments shows principals you never granted anything to:

```
MyPrivateList — full access: Site Owners, SomeOtherAppAdmins, SomeOtherAppUsers, MySolverGroup
```

## Cause

Two facts that only bite in combination:

1. **`copyRoleAssignments=true` copies everything.** The list starts life with a snapshot of the web's role assignments. If any other solution on that site granted `Edit` to its own SharePoint group at web level, that grant lands on your list too.
2. **`Edit` includes `ManageLists`, and `ManageLists` ignores item-level security.** `ReadSecurity = 2` restricts *readers*. A principal with `Edit` or `Full Control` is not a reader — it manages the list and sees every item. Demoting Site Members does nothing about the other groups.

The result is a list that looks locked down in your own code path and is wide open to a group you never thought about.

## Fix

Break **without** copying, then state the intended roles explicitly:

```ts
// 1) no copy — start from an empty ACL
await post(`${listUrl}/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)`);

// 2) grant exactly what belongs here
await setRole(listUrl, ownersId,   ROLE.fullControl);   // site owners keep managing it
await setRole(listUrl, membersId,  ROLE.contributor);   // can add their own items…
await setRole(listUrl, visitorsId, ROLE.reader);        // …ReadSecurity 2 keeps them to their own
await setRole(listUrl, myTeamId,   ROLE.editor);        // the team that must see everything
```

Two guard rails that matter more than they look:

- **Keep a fallback.** If you cannot resolve the associated **Owners** group, do *not* pass `false` — an empty ACL with no owner grant leaves the list reachable only by site collection administrators. Fall back to `copyRoleAssignments=true` and rely on the pruning step below.
- **Know exactly what `false` throws away.** It is not "the web's ACL minus the strangers": the documented result is a single role assignment for the calling account, so the four grants above are now the *entire* permission set of that list. Direct user grants and custom SharePoint groups that legitimately had access are gone too — see [Breaking inheritance without copying keeps only you](../permissions/break-without-copy-keeps-only-you.md) before you use this on an established site. On a site whose parent ACL is not actually polluted, break **with** the copy and prune instead; the two pages recommend opposite defaults on purpose.
- **Prune, don't just detect.** Turning the copy off does nothing for lists that were broken by an **earlier** version of your code. Enumerate the role assignments and drop every principal outside your allow-list — and run it on already-broken lists too:

```ts
const present = await get(`${listUrl}/roleassignments?$expand=Member&$select=PrincipalId,Member/Title`);
for (const ra of present.value) {
  if (allowedIds.indexOf(ra.PrincipalId) === -1) await removeAllRoles(listUrl, ra.PrincipalId);
}
```

If your provisioning writes a "security done" marker, bump its revision so the new logic actually re-runs on sites that already recorded success.

## Verify it, don't assume it

Read the assignments back after the writes, and read what the permissions *mean* rather than what they say:

```
GET /_api/web/GetList('<server-relative-url>')/roleassignments?$expand=Member,RoleDefinitionBindings
GET /_api/web/GetList('<server-relative-url>')/getUserEffectivePermissions(@u)?@u='i:0%23.f|membership|user@contoso.com'
```

A regular account should come back with `ViewListItems` + `AddListItems` and **without** `ManageLists`. Note the single encoding of `#` as `%23` — double-encoding returns HTTP 400.

## Related

- [Item-level permission defaults on provisioned lists](../lists/item-level-permissions-defaults-on-provisioned-lists.md)
- [Field hiding is not a permission](field-hiding-is-not-a-permission.md)
- [An app-provisioned library inherits web write access](app-provisioned-library-inherits-web-write.md)
- [Breaking inheritance without copying keeps only you](../permissions/break-without-copy-keeps-only-you.md)
- [A one-sided permission check passes on an empty ACL](../permissions/one-sided-permission-check-passes-on-an-empty-acl.md) — the pruning above is only as good as the check that follows it
