---
title: Item-level edit rights cover every field – don't trust status, approver or link fields the user can write
short-title: Item edit rights cover every field
summary: "Unique permissions on an item don't separate fields: whoever may edit it can set Status, Approver or a lookup Id via REST – derive trust from admin-only data and version history"
tags: [permissions, item-level, security, rest-api, versioning]
applies-to: SharePoint Online
last-reviewed: 2026-10-09
---

# Item-level edit rights cover every field – don't trust status, approver or link fields the user can write

> **Bottom line.** Giving a user edit rights on *their* item (unique permissions, Contribute or a custom "edit without delete" level) gives them every field of that item – including `Status`, the approver person field, flags and the Id that links the item to another list. The form your app shows doesn't matter: a REST `MERGE` sets anything. Never derive permissions, recipients or writes into other lists from fields the user can edit; take identity from data only administrators write, and check workflow transitions against the version history.
>
> **Ve zkratce.** Kdo smí upravit SVOU položku (vlastní oprávnění, Přispívat nebo vlastní úroveň „upravit bez mazání“), smí upravit každé její pole – i stav, schvalovatele, příznaky a Id vazby na jiný seznam. Formulář appky nehraje roli: REST `MERGE` nastaví cokoli. Oprávnění, adresáty ani zápisy do jiných seznamů neodvozuj z polí, která uživatel upravuje; identitu ber z dat, která píše jen správce, a přechody stavů ověřuj v historii verzí.

## Symptom

A typical design: a monthly report item per employee, unique permissions = employee + their manager + admins, employee has an edit level so they can fill it in. The app then:

- writes the approved report into an append-only log **under the admin's account** when it sees `Status = 'Approved'`,
- re-applies permissions from the `Manager` field on the item when a "permissions set" flag is false,
- e-mails "please approve" to the manager stored on the item.

Each of these can be driven by the employee with one REST call: set `Status` to Approved, point `ManagerId` at a colleague and reset the flag, or change the linked vehicle/driver Ids that end up in the log.

## Cause

Item-level permissions are per item, not per field. Column-level security doesn't exist for list items in SharePoint Online; "read-only" columns in a form are only a UI convention.

## Fix

1. **Identity from admin-only data.** Keep "who is the driver / manager / which vehicle" in a list only administrators write (e.g. an assignment list) and look it up there. If the item carries a link Id, verify it against the **oldest version** of the item (`items(id)/versions`, ordered by `VersionId`): an admin created it, and a user without *Delete Versions* can't remove that version.
2. **Transitions from the version history.** Read `items(id)/versions?$select=VersionId,Status,Editor` and find the version that switched to Approved. Its `Editor.LookupId` must be the expected approver (from admin-only data) or an admin; after that version, data fields must not have been changed by anyone but an admin. Otherwise don't process the item – show it to an administrator.
3. **Validate payloads** you copy into other lists (JSON fields, amounts, dates) – UI validation isn't a boundary.

## Notes

- Residual risk: a user with edit rights may be able to overwrite *Modified By* through `ValidateUpdateListItem` (assumption based on how SharePoint Online behaves – not verified live). Version checks raise the bar and catch ordinary tampering; a real boundary is a decision written somewhere the user can't write (e.g. a server-side function with app permissions).
- Versioning must be on for the list – it usually is for evidence-like lists anyway.
