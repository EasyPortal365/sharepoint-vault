---
title: Restoring inheritance is a one-way door — snapshot the unique assignments first
short-title: Restoring inheritance is a one-way door
summary: "`resetroleinheritance` throws away every unique role assignment and SharePoint keeps no copy, so an \"undo\" is only possible if the code saved the assignments BEFORE the call; re-breaking with `copyRoleAssignments=true` gives you the parent's ACL, not the old one, so the undo has to reconcile (add missing, remove extra) against the snapshot — keyed by principal id and role definition NAME, skipping Limited Access"
tags: [permissions, rest-api, security, governance]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-11-07
---

# Restoring inheritance is a one-way door

> **Bottom line.** "Restore inherited permissions" on a list, library, folder or item is a fix that governance tools love to offer — and it is irreversible on SharePoint's side. The documented behaviour is that the object takes its permissions from the parent again and **loses any users, groups or permission levels that were unique to it**. There is no recycle bin for role assignments and no "previous ACL". If you want an undo button, you have to read the unique assignments yourself, *before* the call, and store them with the change record. The undo is then not "break inheritance" but "break, then reconcile to the snapshot".
>
> **Ve zkratce.** Obnovení dědění oprávnění (`resetroleinheritance`) zahodí všechna vlastní přiřazení rolí a SharePoint si žádnou kopii nenechá – koš ani „předchozí stav“ neexistuje. Kdo chce zásah umět vrátit, musí si přiřazení přečíst a uložit PŘED voláním. Vrácení pak není jen „přerušit dědění“: `breakroleinheritance(copyRoleAssignments=true)` zkopíruje oprávnění rodiče, ne ta původní, takže je potřeba doplnit chybějící a odebrat přebývající podle uloženého stavu – podle id principálu a NÁZVU úrovně oprávnění, bez Omezeného přístupu.

## Symptom

A tool offers "this library has unique permissions — restore inheritance". An administrator clicks it on the wrong library. The tool's audit says *who* did it and *when*. Nobody can say **what the library looked like before** — which group had Contribute, which external approver had Read — so the fix is "ask around and rebuild by hand".

The same happens with scripts: `Set-PnPList -InheritPermissions` (or the REST call below) in a loop, a mistake in the filter, and the unique ACLs of fifty libraries are gone without a trace.

```
POST {web}/_api/web/lists(guid'…')/resetroleinheritance
```

## Cause

Inheritance is all-or-nothing: an object either has its own role assignments or uses its parent's, there is no partial inheritance. Resetting it means the object's own assignment collection is discarded. Microsoft's permissions overview states it plainly: after restoring inherited permissions *"you will lose any users, groups, or permission levels that were unique to the child object."*

Two details make a naive undo wrong:

1. **`breakroleinheritance(copyRoleAssignments=true)` copies the parent's ACL as it is now**, not the object's old one. Anything the parent gained or lost in the meantime ends up on the object, and anything that was unique is still missing.
2. **`copyRoleAssignments=false` leaves only the caller** (see [Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md)), so rebuilding from scratch also means removing yourself at the end — or leaving an admin assignment that was not there before.

## Fix

**Before the reset — snapshot what will be lost:**

```
GET {web}/_api/web/lists(guid'…')/roleassignments
    ?$expand=Member,RoleDefinitionBindings
    &$select=PrincipalId,Member/Title,Member/LoginName,Member/PrincipalType,RoleDefinitionBindings/Name,RoleDefinitionBindings/RoleTypeKind
```

Store per assignment: `PrincipalId`, a display name and login (for the human reading the audit), and the **names** of the bound role definitions (plus `RoleTypeKind` to filter). Write it into the same audit record as the change — if the snapshot write fails, say so instead of claiming the change is revertible.

**To undo:**

1. Read the object again. If it already has unique permissions again (someone fixed it by hand), do not break anything; go straight to reconciling — and tell the person.
2. Otherwise `breakroleinheritance(copyRoleAssignments=true, clearSubscopes=false)`. Copying keeps people who still need access from losing it mid-way; the reconcile step trims the rest.
3. Resolve role definition **names** to ids on the web (`/_api/web/roledefinitions`) — ids are not stable across webs, and names you stored are what you compare. Skip `RoleTypeKind: 1` (Limited Access) on both sides: it is maintained by SharePoint and cannot be granted (see [Limited Access cannot be granted](limited-access-cannot-be-granted.md)).
4. For each snapshot pair (principal, role) that is missing → `addroleassignment(principalid=…, roledefid=…)`. For each current pair that is not in the snapshot → `removeroleassignment(…)`.
5. A principal from the snapshot that no longer exists on the web (deleted group, removed user) cannot be added back — report it per line, do not fail the whole undo silently.
6. Record the undo as a **new** audit entry pointing to the original one; never edit the original record.

## Notes

- The same applies to folders and items: `resetroleinheritance` on an item is just as final. Item-level snapshots get big fast — store them only for the objects the tool actually changed.
- Restoring inheritance on a list does **not** reset items or folders inside it that have their own permissions. A snapshot of the list is not a snapshot of the sub-scopes, and neither is the undo.
- "Who did it and when" is not an undo. An audit row without the state before the change is a confession, not a backup.

## Related

- [Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md)
- [Limited Access cannot be granted](limited-access-cannot-be-granted.md)
- Microsoft Learn: [Overview of site permissions — about permission inheritance](https://learn.microsoft.com/sharepoint/sites/overview-of-site-permissions-in-sharepoint-server#about-permission-inheritance)
