---
title: Narrowing a principal to Read — "already reads" checked before stripping write leaves it with nothing
short-title: Narrowing to Read leaves the principal with nothing
summary: "Edit and Contribute contain the View bit, so a \"does it already read?\" check passes, Read is never added, and the step that removes the write binding then removes the only binding that carried read access — the principal ends with no access and the routine reports unreconciled forever"
tags: [permissions, security, rest-api, provisioning]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-11-03
---

# Narrowing a principal to Read leaves it with nothing

> **Bottom line.** A routine that turns "this group has Edit here" into "this group only reads here" usually does two things: make sure the group reads, then remove its write bindings. If the "does it read?" check looks at the View bit across **all** current bindings, Edit already satisfies it — so Read is never added, and the strip step then removes the only binding that carried read access. Count read access only from the bindings that will **remain** after the strip, add Read first, remove write second.
>
> **Ve zkratce.** Postup „ať skupina jen čte“ obvykle dělá dvě věci: zajistí čtení a odebere zapisující vazby. Když kontrola „už čte?“ hledá bit View ve VŠECH současných vazbách, Úpravy ji splní – Čtení se nepřidá a krok odebrání zápisu pak vezme jedinou vazbu, ze které čtení plynulo. Čtení počítej jen z vazeb, které po zásahu ZŮSTANOU; nejdřív přidej Čtení, pak odeber zápis.

## Symptom

A provisioning or hardening pass is meant to leave a SharePoint group with read-only access to one object — an app page, a list, a single item. On an object where the group previously had **Edit** (or Contribute, or any custom level with write bits):

- after the pass the group has **no role assignment at all** on the object — its members get access denied where they could previously open the page;
- the pass verifies by re-reading the ACL, sees "group does not read", reports *not reconciled* — and on the next run does exactly the same thing again, because the group now has nothing and the check would add Read... unless the object went through the same logic in the opposite order, in which case it oscillates.

Where the group never had a write level on the object, the routine works fine — which is why this survives in production code until a test with a stateful fake ACL hits it.

## Cause

The usual decomposition:

```
reads   = bindings(principal).some(b => hasBit(b.permissions, ViewListItems))
if (!reads)        addRoleAssignment(principal, Read)
if (stripWrite)    removeRoleAssignment(principal, each binding with write bits)
```

Edit, Contribute and Full Control all include `ViewListItems`. So `reads` is `true` for a principal whose **only** binding is Edit. Read is skipped, then the strip removes Edit — the binding `reads` was counting on.

The two steps are not independent: the second one changes the input of the first.

## Fix

Decide what will be removed **before** asking whether the principal reads, and ask the question about the remainder:

```
write  = stripWrite ? bindings(principal).filter(hasWriteBits) : []
keeps  = bindings(principal).filter(b => !write.includes(b))
if (!keeps.some(b => hasBit(b.permissions, ViewListItems)))
  addRoleAssignment(principal, Read)          // add first — no window without access
for (b of write)
  removeRoleAssignment(principal, b.roleDefId)
verify: re-read roleassignments, principal has View and no write bits
```

REST for the two writes (both need ManagePermissions on the object):

```
POST {object}/roleassignments/addroleassignment(principalid={id},roledefid={readId})
POST {object}/roleassignments/removeroleassignment(principalid={id},roledefid={editId})
```

## How to test it

A stateful fake ACL catches this in seconds where a mocked "returns OK" never will:

- the case **"principal has only Edit, target is Read only"** — expect exactly one Read binding afterwards;
- sabotage: `addroleassignment` returns 200 and changes nothing — the routine must report *not reconciled*, not success;
- the same sabotage for `removeroleassignment`.

The general rule behind it: "principal has capability X" computed over the sum of its bindings says nothing about what remains after you remove one of them.

## Sources

- [Permission levels in SharePoint](https://learn.microsoft.com/sharepoint/understanding-permission-levels) — the list-permissions table shows *View Items* in Full Control, Design, Edit and Contribute, not only in Read.
- Measured with a stateful fake ACL in the test suite of a shared provisioning package (15 cases, including add/remove sabotage); the defect was present in two independent copies of the routine.
