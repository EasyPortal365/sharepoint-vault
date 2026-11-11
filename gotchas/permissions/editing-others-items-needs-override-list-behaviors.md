---
title: "Manage Lists lets you read other people's items on a WriteSecurity 2 list, but not edit them — that takes Override List Behaviors"
short-title: Editing others' items needs Override List Behaviors
summary: On a list with item-level write security, the Edit role (Manage Lists) still gets 403 when it updates an item someone else created; only a role with Override List Behaviors (`CancelCheckout`, Low 0x100) gets through, so moving a group from Full Control to Edit silently takes that ability away
tags: [permissions, lists, item-level-security, roles, least-privilege]
applies-to: SharePoint Online — lists with `WriteSecurity = 2` (and probably `4`), measured with REST MERGE
last-reviewed: 2026-11-11
---

# Manage Lists lets you read other people's items on a WriteSecurity 2 list, but not edit them — that takes Override List Behaviors

> **Bottom line.** Manage Lists bypasses item-level **read** security, but not item-level **write** security. A user with the built-in **Edit** role (which carries Manage Lists) gets HTTP 403 when updating an item someone else created on a `WriteSecurity = 2` list. What lets them through is **Override List Behaviors** (`CancelCheckout`, Low bit `0x100`), which Full Control and Design carry and Edit does not. Before you narrow a group from Full Control to Edit, list `WriteSecurity` on every list it maintains — or give it a custom level "Edit + Override List Behaviors".
>
> **Ve zkratce.** Spravovat seznamy obchází item-level **čtení**, ale ne item-level **zápis**. Uživatel s vestavěnou úrovní **Úpravy** (ta Spravovat seznamy má) dostane na seznamu s `WriteSecurity = 2` při úpravě cizí položky HTTP 403. Projde až s právem **Přepsat chování seznamu** (`CancelCheckout`, bit `0x100` v Low), které má Úplné řízení a Návrh, ale Úpravy ne. Než skupinu zúžíš z Úplného řízení na Úpravy, vypiš `WriteSecurity` všech seznamů, které spravuje – nebo jí dej vlastní úroveň „Úpravy + Přepsat chování seznamu“.

## Symptom

A security review asks you to take Full Control away from the group that runs an application ("the maintainers can change permissions and group membership — they don't need that"). You move the group to **Edit** on the site and on the lists. Everything you try as the site owner still works. Then a maintainer reports that:

- they can no longer fix a record a colleague entered,
- a settings row (created by whoever installed the app) can no longer be saved,
- a lookup table they maintain rejects every change.

The responses are `403 Access is denied`, although the maintainer's effective permissions on the list show both **Edit Items** and **Manage Lists**.

## Cause

`WriteSecurity = 2` means "users can modify only items they created". The common wisdom — repeated in many places — is that **Manage Lists** overrides item-level settings. That is true for **reading**: a user with Manage Lists sees every item on a `ReadSecurity = 2` list. It is **not** true for writing. Measured on SharePoint Online (11 November 2026), same user, same item, created by another account:

| User's level on the list | Low mask | Manage Lists | Override List Behaviors | `MERGE` of another user's item |
|---|---|---|---|---|
| Edit | `1011030767` | yes | no | **403** |
| Custom: Edit + Override List Behaviors | `1011031023` | yes | yes | **204** |

The only difference between the two masks is `0x100` — `CancelCheckout`, shown in the UI as **Override List Behaviors**: *"Discard or check in a document which is checked out to another user, and change or override settings which allow users to read/edit only their own items"*. Full Control and Design carry it, Edit and Contribute do not.

Full Control hides the problem: it carries every bit, so testing from an owner or administrator account always succeeds. That is also why the dependency appears only on the day you take Full Control away.

## Fix

1. **Inventory first.** Before narrowing a role, read the item-level settings of every list the group works with:

   ```http
   GET /_api/web/lists?$select=Title,ReadSecurity,WriteSecurity,HasUniqueRoleAssignments&$top=5000
   ```

   Any list with `WriteSecurity` ≠ 1 where the group must edit *other people's* items needs Override List Behaviors.

2. **Create a custom level** instead of falling back to Full Control or Design: Edit (or Contribute) plus `CancelCheckout`, without Manage Permissions, Manage Web or Enumerate Permissions.

   ```js
   // Derive from the site's own Edit level so localisation and tenant tweaks don't matter.
   const edit = defs.find(d => d.RoleTypeKind === 6);            // Editor
   const base = Number(edit.BasePermissions.Low);
   // Low can exceed int32, so no bitwise OR – add the bit only if it is missing.
   const low  = Math.floor(base / 0x100) % 2 ? base : base + 0x100;   // + Override List Behaviors
   await post(`${web}/_api/web/roledefinitions`, {
     '@odata.type': '#SP.RoleDefinition',
     Name: 'App maintainers',
     Description: 'Edit + Override List Behaviors, no permission management',
     Order: 160,
     BasePermissions: { '@odata.type': '#SP.BasePermissions', Low: low, High: Number(edit.BasePermissions.High) }
   });
   ```

   Read the level back and check the bits you rely on — not its name.

3. **Bind it before you remove Full Control**, on the site *and* on every list with unique permissions where the group writes. If lists are hardened by breaking inheritance with a copy of the site's role assignments, binding the level on the site also carries it to lists created later.

4. **Test the write as the maintainer**, not as the owner: update an item another account created, then read it back.

## Notes

- **Design** also carries Override List Behaviors and would work, but it adds page customisation and theme rights. The custom level is narrower.
- `WriteSecurity = 4` ("nobody can modify items") was not measured here. Earlier reports that "Design gets through" are consistent with this finding, because Design carries Override List Behaviors. Don't assume Edit is enough there either — measure it.
- Item-level **read** (`ReadSecurity = 2`) *is* bypassed by Manage Lists alone. See [A count over a ReadSecurity 2 list is only the reader's share](a-count-over-a-readsecurity-2-list-is-the-readers-share.md).
- Related: [WriteSecurity 4 ignores Contribute](write-security-4-needs-managelists.md), [Item-level permission defaults on provisioned lists](../lists/item-level-permissions-defaults-on-provisioned-lists.md).
