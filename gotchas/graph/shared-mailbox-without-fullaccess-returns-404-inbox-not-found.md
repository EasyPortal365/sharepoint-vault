---
title: Delegated Graph on a shared mailbox without FullAccess returns 404 "Default folder Inbox not found", not 403
short-title: Shared mailbox without FullAccess = 404 Inbox not found
summary: "`/users/{shared}/mailFolders/inbox/messages` under a user without FullAccess → 404 ErrorItemNotFound; treat it as a permission problem and never stamp the run as \"checked\""
tags: [graph, exchange-online, shared-mailbox, mail-read, permissions, error-handling]
applies-to: Microsoft Graph v1.0 (delegated Mail.ReadWrite.Shared), Exchange Online shared mailboxes, SPFx MSGraphClientV3
last-reviewed: 2026-11-21
---

# Shared mailbox without FullAccess → 404 "Default folder Inbox not found"

> **Bottom line.** A client-side app that reads a shared mailbox with delegated Graph (`/users/support@contoso.com/mailFolders/inbox/messages`) gets **HTTP 404 `ErrorItemNotFound` — "The specified object was not found in the store., Default folder Inbox not found."** when the signed-in user has no FullAccess on that mailbox. It is not a 403 and it does not say "access denied", so it reads like a broken mailbox. Treat it as "this user cannot read the mailbox", show which mailbox failed, and never record the run as a successful check.
>
> **Ve zkratce.** Aplikace, která čte sdílenou schránku delegovaným Graphem, dostane pod uživatelem bez FullAccess **HTTP 404 `ErrorItemNotFound` – „Default folder Inbox not found“**, ne 403. Vypadá to jako rozbitá schránka, ale chybí oprávnění. Ukažte, kterou schránku se nepodařilo přečíst, a běh nikdy nezapisujte jako úspěšnou kontrolu.

## Symptom

- The app shows "mail last checked: 2 minutes ago", yet no message from the shared mailbox ever becomes a ticket/record.
- The browser console (if the app logs it) holds:

```
HTTP 404 · ErrorItemNotFound: The specified object was not found in the store., Default folder Inbox not found.
```

- The same mailbox opens fine in Outlook for **another** user, and Graph Explorer under that other user lists the inbox.

## Cause

Delegated access to another mailbox needs both the scope (`Mail.Read.Shared` / `Mail.ReadWrite.Shared`) **and** an Exchange mailbox permission (FullAccess, or folder permissions) for the signed-in user. Without the Exchange permission, Exchange does not reveal the folder to that user, and Graph reports the well-known folder as not found. A Global Admin is not automatically a member of shared mailboxes — "the admin can do anything" does not apply to mailbox content.

A second, app-side problem makes it invisible: if the polling loop catches the per-mailbox error and then writes a "last checked at …" stamp regardless, the UI keeps saying everything is fine.

## Fix

1. Give the users who run the app FullAccess (and SendAs, if the app replies from the mailbox) — Exchange admin center → the shared mailbox → Members.
2. Or run the processing under an account that already has that access.
3. In the app, map `404 ErrorItemNotFound` on a mailbox folder to "cannot read mailbox X (missing FullAccess?)", and keep the failure in the "last checked" state:

```ts
// write the stamp with the failed mailboxes, the UI decides green vs. amber from it
const failed: string[] = [];
for (const q of queues) {
  try { await ingestInbox(q); }
  catch (e) { failed.push(q.mailbox); errors.push(`${q.mailbox}: ${detail(e)}`); }
}
await setStamp('mail-check', `${new Date().toISOString()}|${me}` + (failed.length ? `|fail:${failed.join(',')}` : ''));
```

## Verify

- Under the affected user, `GET /users/{shared}/mailFolders/inbox?$select=id` → 404; under a member of the mailbox → 200.
- After granting FullAccess, allow some minutes for Exchange to apply it before re-testing.
