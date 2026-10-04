---
title: An "add what's missing" permission sync turns every change of owner into a leak — the previous owner keeps access
short-title: Add-only permission sync leaks on owner change
summary: Idempotent grant-only re-sync is safe at item creation but not when an item moves to another customer or team — the old group stays on the item; remove by principal Id, keep a protected set, and verify with a second roleassignments read
tags: [permissions, item-level-security, unique-permissions, roleassignments, multi-tenant-lists]
applies-to: SharePoint Online and Server — any code that maintains unique permissions on list items or files per customer, team or owner
last-reviewed: 2026-10-04
---

# An "add what's missing" permission sync turns every change of owner into a leak — the previous owner keeps access

> **Bottom line.** A permission sync that only *adds* the grants an item should have is safe when the item is created. When the item later moves to another owner (another customer, team or department), the same sync gives access to the new owner and silently leaves the old one in place. No error, no warning — the previous owner keeps reading the item. Every re-sync that can change ownership must also *remove* grants, by principal Id, and then check the result by reading `roleassignments` a second time.
>
> **Ve zkratce.** Synchronizace oprávnění, která položce jen *doplní* chybějící granty, je bezpečná při založení položky. Když položka později přejde jinému vlastníkovi (jinému zákazníkovi, týmu, oddělení), nový vlastník přístup dostane – a starý tiše zůstane. Žádná chyba ani varování, původní vlastník položku dál čte. Každý přepočet, který může změnit vlastníka, musí granty i *odebírat*, podle Id principála, a výsledek ověřit druhým čtením `roleassignments`.

## Symptom

A helpdesk list keeps tickets in one list with broken inheritance per ticket: the customer's SharePoint group gets Read, the agents get Contribute. An admin moves a ticket to another customer by editing the customer column, then runs the "re-apply permissions" action. The new customer's group appears on the ticket. The old customer's group is still there too, and still sees the ticket and its messages.

## Cause

The sync was written as "make sure these principals have these roles" — `roleassignments/addroleassignment` for whatever is missing. That is idempotent and harmless on a fresh item. It has no notion of "this principal should no longer be here", so a change of owner is only half applied.

## What to do

1. **Remove by principal Id, never by group name.** Build an index of the groups that represent owners (customer groups, team groups) by Id. On an item owned by X, remove every owner-group that is not X's: `POST …/items(n)/roleassignments/removeroleassignment(principalid=…, roledefid=…)` for each granting role (or without `roledefid` to remove all of that principal's roles on the item).
2. **Keep a protected set.** The current owner's groups, the requester and the agents are never removed, even if the index wrongly lists them under another owner.
3. **If the index can't be read, remove nothing** and say so. A partial index would remove the wrong groups.
4. **Verify with a second read.** Read `roleassignments?$expand=Member,RoleDefinitionBindings` again after writing. If the old group is still there, or someone outside the removal set lost a role, report failure. Don't report "done".
5. **Items that inherit permissions:** leave them alone and report them. Don't break inheritance just to remove something.
6. **Test both directions.** An add-only implementation must fail the test because the old group stays. A "replace everything" implementation must fail it too, because a grant outside the removal set disappears.

## Clean-up of items moved earlier

Items that were moved before the fix still carry the old group. Start with a read-only pass: list the `roleassignments` of every item and compare them with the owner index. That gives the items where another owner's group is present. Re-apply permissions only on that list.
