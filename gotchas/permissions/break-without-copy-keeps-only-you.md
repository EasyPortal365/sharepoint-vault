---
title: Breaking inheritance without copying keeps only YOU — and the re-grant forgets custom groups
tags: [permissions, security, rest-api, provisioning]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-01
---

# Breaking inheritance without copying keeps only you

> **Bottom line.** `breakroleinheritance(copyRoleAssignments=false)` does not leave "the site's groups minus the strangers" behind — per the documented contract it leaves exactly **one** role assignment: the account that made the call. Code that then grants Owners, Members and Visitors looks complete and quietly drops every direct grant and every custom SharePoint group. Worse, if the object carries configuration that a feature reads, the account that can no longer read it may end up running with that feature's limits switched **off** — so a hardening pass can lower security for exactly the people it locked out.
>
> **Ve zkratce.** `breakroleinheritance(copyRoleAssignments=false)` nenechá na objektu „skupiny webu minus cizí“ – podle dokumentace nechá jediné přiřazení role: účet, který volání provedl. Kód, který pak přidá Vlastníky, Členy a Návštěvníky, vypadá úplně, ale tiše zahodí každé přímé přiřazení i každou vlastní skupinu. A když objekt nese konfiguraci, kterou nějaká funkce čte, může účet bez čtení běžet úplně bez jejích omezení – zpevnění tedy může bezpečnost snížit právě těm, koho odřízlo.

## Symptom

A tightening pass runs over a library or list — break inheritance, grant the writers, demote everyone else — and reports success. Then:

- One person opens the site and the list is **empty**, or the page 403s where it never did before. They were never in Members; they had a direct grant, or they were in `ProjectDocs Approvers`, a SharePoint group someone created years ago.
- Nobody else notices, because the three default groups cover almost everyone.
- In the nastiest variant nobody notices at all — the account that lost the read is a service or reporting account, and what it lost was a **settings** list, not content.

## Cause

`copyRoleAssignments` is not a filter. The documented behaviour of `BreakRoleInheritance(false)` is that after the call the role assignment collection **contains only the current user** — the caller acquires the level needed to manage the object, and everything else is gone (`SPSecurableObject.BreakRoleInheritance`: *"false to assign only the current user to security roles"*).

So a routine that breaks without copying has to reconstruct the entire ACL, and reconstruction is where the assumption creeps in. The associated groups are the easy part:

```
GET /_api/web?$select=AssociatedOwnerGroup/Id,AssociatedMemberGroup/Id,AssociatedVisitorGroup/Id
    &$expand=AssociatedOwnerGroup,AssociatedMemberGroup,AssociatedVisitorGroup
```

Three ids, three `addroleassignment` calls, done. What that never covers:

- **direct user grants** at web level — someone added individually, years ago;
- **custom SharePoint groups** — approvers, records managers, a group another solution created;
- **directory security groups** granted at web level;
- anything an earlier version of the same routine granted.

None of these is exotic. On any site older than a few months, at least one exists.

## The part that inverts the intent

A lockout is normally a nuisance, not a security event. It becomes one when the object you hardened holds **configuration that a feature reads to decide how restrictive to be** — an allow-list of sources, a scope, a table of excluded areas. Then the consumer's behaviour on a failed read decides what the lockout means:

| The read fails and the code… | Result for the locked-out account |
|---|---|
| falls back to documented defaults (**fail-safe**) | the feature behaves as if freshly installed — annoying, not dangerous |
| treats "no rows" as "nothing is restricted" (**fail-open**) | the limits do not apply to that account at all |

The second row is not hypothetical: an empty result and an unreadable list are identical to any helper that resolves a non-OK response to `[]`. The account that lost its read is then the one account for which the boundary is missing — and it stays invisible, because the report you ran was about **write** access.

Hence the acceptance criteria for a permission change need a *positive* half: **"the people and accounts that must read it can still read it"**, standing next to "the people who should not write it can no longer write it".

## Fix

**Snapshot before you break, and re-grant from the snapshot — not from a hardcoded list of three.**

```ts
// 1) what does this scope actually grant today?
const before = await getStrict(
  `${web}/_api/web/GetList('${listUrl}')/roleassignments` +
  `?$expand=Member,RoleDefinitionBindings` +
  `&$select=PrincipalId,Member/Title,Member/PrincipalType,RoleDefinitionBindings/Name`
);
// getStrict throws on any non-OK response. An empty ACL here is a failed read,
// not a scope with no permissions — never continue on it.

// 2) break while KEEPING what exists, so a half-failure changes nothing
await post(`${web}/_api/web/GetList('${listUrl}')` +
           `/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)`);

// 3) grant the writers, 4) then downgrade the rest, 5) then re-read and verify
```

Breaking **with** the copy and pruning afterwards is the safer order for exactly this reason: the intermediate state equals the old state, so a failure between calls locks nobody out. Pruning is then a decision per principal that you can log, rather than an omission you cannot see.

If you do break without copying — the right call when the parent ACL is genuinely polluted (see *Breaking inheritance copies foreign Edit grants*) — then:

- re-grant **from the snapshot**, mapping each pre-existing principal to the level you intend it to keep;
- if the snapshot read failed, **abort**; do not fall back to "grant the three default groups";
- leave **Limited Access** (`RoleTypeKind: 1`) alone — SharePoint maintains it so users can traverse to the object;
- remember the caller is now an explicit Full Control holder there. If that is a provisioning identity rather than a person, decide deliberately whether it stays.

### Prove the read still works, for a real principal

Site collection administrators bypass every scope, so "I can still open it" from your own session proves nothing. Ask about someone else, without their password:

```
GET /_api/web/GetList('<server-relative-url>')/getusereffectivepermissions(@u)
    ?@u='i:0%23.f|membership|megan@contoso.com'
```

`#` is encoded **once** as `%23`; double-encoding returns HTTP 400. Confirm `ViewListItems` for a reader you meant to keep, and the absence of `AddListItems`/`EditListItems` for someone you meant to exclude. A zero mask means no access at all.

## Notes

- The same applies at **web** scope: a site-level break with no copy leaves one person on the whole site.
- `clearSubscopes=true` discards unique permissions on folders and items below. That is usually what you want when re-establishing a policy — and always something to state in the change record.
- Groups whose membership you cannot read are easy to mis-audit; see *A group created by code hides its own membership*.

## Related

- [Breaking inheritance copies foreign Edit grants](../security/breaking-inheritance-copies-foreign-edit-grants.md) — the opposite failure, and why the two pages differ on `copyRoleAssignments` by design
- [A one-sided permission check passes on an empty ACL](one-sided-permission-check-passes-on-an-empty-acl.md)
- [WriteSecurity 4 ignores Contribute](write-security-4-needs-managelists.md)
- [App-provisioned libraries inherit the web's write permissions](../security/app-provisioned-library-inherits-web-write.md)
- [Effective permissions come as a bitmask](../security/effective-permissions-bitmask-off-by-one.md)
