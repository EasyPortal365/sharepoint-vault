---
title: Item-level edit rights cover every field – don't trust status, approver or link fields the user can write
short-title: Item edit rights cover every field
summary: "Unique permissions on an item don't separate fields: whoever may edit it can set Status, Approver or a lookup Id via REST – derive trust from admin-only data and version history"
tags: [permissions, item-level, security, rest-api, versioning]
applies-to: SharePoint Online
last-reviewed: 2026-11-19
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

Item-level permissions are per item, not per field: the permission scopes are site, list or library, folder and item – "the narrowest level (a single item in a list)" ([Permission levels in SharePoint](https://learn.microsoft.com/sharepoint/understanding-permission-levels)). There is no permission scope for a column, so hiding or disabling a column in your form doesn't protect it from a REST update.

## Fix

1. **Identity from admin-only data.** Keep "who is the driver / manager / which vehicle" in a list only administrators write (e.g. an assignment list) and look it up there. If the item carries a link Id and the item was created by an administrator, verify the Id against the **oldest version** of the item (`items(id)/versions`, lowest `VersionId`): a level without *Delete Versions* can't remove past versions. Note that the default **Contribute** level *includes* Delete Versions – use a custom level without it.
2. **Transitions from the version history.** Read `items(id)/versions?$select=VersionId,Status,Editor` and find the version that switched to Approved. Its `Editor.LookupId` must be the expected approver (from admin-only data) or an admin; after that version, data fields must not have been changed by anyone but an admin. Otherwise don't process the item – show it to an administrator.
3. **Validate payloads** you copy into other lists (JSON fields, amounts, dates) – UI validation isn't a boundary.
4. **Re-securing an item from its own fields is the same trap, one step worse.** A background job that "repairs" unique permissions by reading `AssignedBy`, `Manager` or `Buddy` from the item hands out access according to whatever the participant last wrote – including Manage Permissions to themselves – and it runs under the account of whoever opens the admin screen next. Before every grant, compare the identity fields with version `1.0` (`items(id)/versions?$select=VersionLabel,<fields>` – created by the assigner, not removable without *Delete Versions*), allow only an explicitly named change (e.g. an invitation placeholder replaced by the real account once, with every intermediate version equal to either the original or the current value), and anchor the creator on the server-side `AuthorId`, which a REST update can't change. If a version limit has trimmed `1.0` away, **don't grant anything** and say why – never fall back to trusting the fields.

## Notes

- **Modified By of a version is reliable – measured 2026-11-17** for a user with edit rights on the item: `ValidateUpdateListItem` with `Editor` set to another account returns HTTP 200 with no `HasException`, but the version's Editor stays the caller. With `bNewDocumentUpdate: true` over a version saved by someone else, the content of that version is overwritten **and its Editor becomes the caller**. So the Editor of a version always names who wrote that version's content, and a check of transitions against version history is a real boundary against the people on the item, not just a raised bar. For users who may only **add** items, `Author`, `Editor` and `Created` sent with `AddValidateUpdateItemUsingPath` were likewise replaced by the caller and the current time (measured 2026-11-12) – see [List items with authors, dates and history](../lists/list-items-keep-authors-dates-and-version-history.md).
- What remains: the version limit can trim the oldest versions (including the one the creator saved), so treat missing history as "unknown", never as "fine". A user without DeleteVersions can't delete versions.
- **Take the LAST switch to Approved, not the first.** The submitter can send an approved item back to *Submitted*, change the dates or amount and set *Approved* again; a check that stops at the first approved version finds the old, genuine approval and passes. Walk to the most recent transition, check its Editor, and only then look for later changes.
- **Three outcomes, not two.** Return `ok`, `bad` or `unknown`; trimmed or unreadable history is `unknown`. `unknown` blocks closing steps (payroll export, invoicing, issuing a document) and is shown to an administrator – but it must not trigger a delete either: a "rebuild the calendar from approved items" job that removes everything not `ok` wipes genuine rows whose history was trimmed. Remove only `bad`.
- **"Not the submitter" is weaker than "the recorded approver".** If the item names an approver (person field or object id written by an administrator), the Editor of the approving version must be that person, or an administrator acting for them; any other colleague with edit rights on the item is a third outcome (`foreign`), not a pass.
- Versioning must be on for the list – it usually is for evidence-like lists anyway.
