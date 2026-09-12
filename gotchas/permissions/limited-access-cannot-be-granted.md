---
title: Limited Access cannot be granted — the API returns 200 and does nothing
tags: [permissions, rest-api, provisioning, csom]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-12
---

# Limited Access cannot be granted

> **Bottom line.** `Limited Access` (`RoleTypeKind: 1`) is not a permission level an administrator hands out — SharePoint maintains it itself so that people can *traverse* to a child object that has its own permissions. An explicit `addroleassignment` with its `roledefid` is **accepted and discarded**: HTTP 200, no change. Any code that copies role assignments from one object to another must strip it, or its own verification pass will report a mismatch that is not a mismatch.
>
> **Ve zkratce.** `Limited Access` (`RoleTypeKind: 1`) není úroveň, kterou uděluje správce — SharePoint si ji spravuje sám, aby se dalo projít k potomkovi, který má vlastní oprávnění. Explicitní `addroleassignment` s jejím `roledefid` server **přijme a zahodí**: HTTP 200, žádná změna. Kód, který kopíruje přiřazení rolí mezi objekty, ji musí odfiltrovat — jinak jeho vlastní ověření nahlásí neshodu, která žádnou neshodou není.

## Symptom

You replicate a permission shape from one object to another — read `roleassignments` on the source, re-create them on the target — then read the target back to verify. The write returned `200`. The read-back says the principal does not have `Limited Access`.

It looks like the server silently dropped an assignment. It did, but not because anything is wrong.

## Why

`Limited Access` is a **derived** level. SharePoint grants it automatically on every ancestor scope when a descendant gets unique permissions, so the user can open the path to that descendant without being able to see anything else. It disappears on its own once the reason for it is gone.

Because it is derived, it is not assignable:

```http
POST /_api/web/GetList(@a1)/roleassignments/addroleassignment(principalid=5,roledefid=1073741825)?@a1='/sites/x/Shared Documents'
→ 200 OK        # and the assignment is not there afterwards
```

The trap is not the first grant — it is the **read side**. A naive filter drops `Limited Access` only when it is the *only* role in an assignment. That misses the common shape: a group holding `Limited Access` on the library (because it has explicit rights on folders inside) **and** `Contribute` on those folders. The library assignment survives the filter, gets replicated, and fails silently on the target.

## Rules

1. **When reading permissions in order to replicate them, strip `Limited Access` from every assignment** — not only from assignments where it stands alone. If nothing is left in an assignment afterwards, drop the assignment; otherwise you produce a scope with nothing to set.

2. **Detect it by `RoleTypeKind === 1`, never by name.** The display name is localised (`Omezený přístup` in Czech, `Accès limité` in French). Fall back to the name only where you genuinely have no `RoleTypeKind` — and then match the localised spellings too.

3. **Put a guard on the WRITE side as well, not just the read side.** Before assigning, check the `RoleTypeKind` of the resolved role definition **on the target web**. That is the only place that knows the truth regardless of language and regardless of what your input data carries — the read filter protects new data, the write guard protects data you stored before you knew.

4. **Do not count an emptied scope as work.** If a plan/preview step counts scopes by `HasUniqueRoleAssignments` while the execution step skips those with nothing to assign, the two numbers disagree — on exactly the operation whose credibility rests on them agreeing.

## Why it matters beyond the noise

A false finding is a defect of its own. A verification pass is worth having only while its findings mean something; one that routinely reports non-problems teaches the reader to skim past them — and past the one real problem in the list.

## Related

- [Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md) — the other half of replicating a permission shape.
- [Unique role assignments is not proof of hardening](unique-role-assignments-is-not-proof-of-hardening.md) — `HasUniqueRoleAssignments: true` says a scope exists, not what is in it.
