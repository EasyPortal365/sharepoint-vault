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

Delegated access to another mailbox needs both the scope (`Mail.Read.Shared` / `Mail.ReadWrite.Shared` — "mail a user has permission to access" [1]) **and** an Exchange mailbox permission for the signed-in user: Full Access to open the shared mailbox, Send As to send from it [2]. Without the Exchange permission, Graph reports the well-known folder as not found (measured, see below). An admin role does not open mailbox content by itself — even an administrator who should read all mailboxes is granted Full Access explicitly with `Add-MailboxPermission` [3].

Measured 2026-11-21 on one shared mailbox, same SPFx app, same request: the user who is a member of the mailbox (has it in Outlook) → 200 and the messages; a Global Admin who is not a member → the 404 above on every poll.

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
- A freshly granted permission can take a while to show up — Microsoft mentions up to a few hours for the mailbox to appear in Outlook [3]; re-test later before concluding it didn't work.

## Sources

1. [Microsoft Graph permissions reference – Mail.ReadWrite.Shared](https://learn.microsoft.com/graph/permissions-reference) · [Get Outlook messages in a shared or delegated folder](https://learn.microsoft.com/graph/outlook-share-messages-folders)
2. [Shared mailboxes in Exchange Online – Which permissions should you use?](https://learn.microsoft.com/exchange/collaboration-exo/shared-mailboxes)
3. [Accessing other people's mailboxes in Microsoft 365](https://learn.microsoft.com/troubleshoot/exchange/user-and-shared-mailboxes/how-to-access-other-mailboxes)
