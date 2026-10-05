---
title: GetUserEffectivePermissions ignores the user's Entra security groups — and Full Control's effective mask is not the role's mask
short-title: Effective permissions ignore security groups
summary: "Asked on behalf of another user, `GetUserEffectivePermissions` counts Microsoft 365 group membership but not Entra security group membership — directly assigned or nested in a SharePoint group, still after 40 s — so it reports 'no access' for people who do have it once they sign in. Ask with the group's claim instead (that works), union the roles reached through the user's transitive security groups, treat a mask without any content bit (Limited Access, even with extra bits) as no access, and drop NoScript-stripped bits (AddAndCustomizePages) before mapping a mask to a permission level"
tags: [permissions, rest-api, entra-id, graph]
applies-to: SharePoint Online
last-reviewed: 2026-10-05
---

# Effective permissions ignore security groups

> **Bottom line.** `GetUserEffectivePermissions(@u)` asked for *another* user does not see that user's Entra **security** group memberships. A security group granted Read on a folder leaves the member's mask at `0/0`; nested inside the site's Visitors group it leaves `Limited Access`. Microsoft 365 groups are counted. The user does get access once they sign in — the measurement under-reports. Union the roles reached through the user's transitive security groups, and map masks to levels with the bits the site strips removed.
>
> **Ve zkratce.** `GetUserEffectivePermissions(@u)` za *jiného* uživatele nevidí jeho členství v **bezpečnostních** skupinách Entra ID. Bezpečnostní skupina s Read na složce nechá členovi masku `0/0`, vnořená v Návštěvnících jen `Limited Access`. Skupiny Microsoft 365 se započítají. Uživatel po přihlášení přístup má – měření ukazuje méně. Role z cest přes jeho tranzitivní bezpečnostní skupiny je potřeba přičíst a při převodu masky na úroveň vyřadit bity, které web plošně odebírá.

## Symptom

A clean site, one test account that is a member of two new groups: one security group, one Microsoft 365 group. Measured with `GetUserEffectivePermissions` on the same folder and on the web:

| Grant | Mask of the user | Mask of the group claim |
|---|---|---|
| M365 group, Contribute, directly on the folder | Contribute `1b0 / 3c4312ef` | Contribute |
| Security group, Read, directly on the folder | `0 / 0` | Read `b0 / 08431061` |
| Security group nested in the site's Visitors | `30 / 08011000` (Limited Access), unchanged after 40 s | Read |
| M365 group nested in the site's Visitors | Read | — |

Asking with the group's claim (`c:0t.c|tenant|<objectId>`) works, including the nested case.

## Why

Assumption that fits every measurement: SharePoint learns security group membership from the user's sign-in token, while it resolves Microsoft 365 group membership itself. A server-side evaluation for someone who is not the caller has no token to read from.

## What to do

1. **User's level = mask ∪ roles reached through security groups.** Read the object's `roleassignments?$expand=Member,RoleDefinitionBindings`, take the user's transitive groups from Graph (`/users/{id}/transitiveMemberOf`), and add the roles of every security-group claim the user belongs to — directly assigned or as a member of an assigned SharePoint group. Say in the UI that this part is derived from Entra ID.
2. **No content capability is no access.** A mask of `30 / 08011000` (Limited Access) or `0 / 0` means the user can traverse, not read — but don't test for "subset of Limited Access": a Limited-Access-only account measured `230 / 08011000` (an extra High `0x200` bit). Decide "no access" by the absence of every content bit (view, add, edit, delete, approve, manage).
3. **Full Control's effective mask is not the role's mask.** On a modern site with custom scripts disabled the site collection admin measures `7fffffff / fffbffff`; the Full Control role is `7fffffff / ffffffff`. `AddAndCustomizePages` (`0x40000`) is stripped. A "role bits ⊆ mask" mapping turns both Full Control and Design into Edit — remove the bits the site strips before comparing.
4. **`ensureuser` takes a group claim.** `POST web/ensureuser {logonName: "c:0t.c|tenant|<id>"}` (or the M365 members claim `c:0o.c|federateddirectoryclaimprovider|<id>`) returns `PrincipalType 4` and an Id usable in `addroleassignment`.
5. **Test with both group types.** One type alone hides this.

Related: [Limited Access cannot be granted](limited-access-cannot-be-granted.md) · [PermissionKind is 1-based](permissionkind-is-one-based-off-by-one-fakes-a-finding.md) · [A status code measures the order of checks, not permissions](status-code-measures-the-order-of-checks-not-permissions.md)
