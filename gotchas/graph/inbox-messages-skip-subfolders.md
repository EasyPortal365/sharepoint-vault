---
title: "\"Received mail\" from /me/mailFolders/inbox/messages misses Inbox subfolders — and /me/messages includes Sent Items"
short-title: "Inbox messages skip subfolders; /me/messages includes Sent"
summary: "A folder's messages collection holds only messages directly in that folder, so rule-sorted mail in Inbox subfolders is missing; /me/messages is the whole mailbox incl. Sent, Drafts and Deleted. Read /me/messages with parentFolderId and drop the well-known non-received folders client-side"
tags: [graph, mail, outlook, troubleshooting]
applies-to: Microsoft Graph v1.0 (Microsoft 365, delegated Mail.Read)
last-reviewed: 2026-11-19
---

# "Received mail" from `/me/mailFolders/inbox/messages` misses Inbox subfolders — and `/me/messages` includes Sent Items

> **Bottom line.** `GET /me/mailFolders/inbox/messages` returns only messages that sit **directly** in the Inbox — mail that a rule moved into an Inbox subfolder is not there. `GET /me/messages` is the **whole mailbox**, including Sent Items, Drafts and Deleted Items. For a "mail I received" overview, read `/me/messages` with `parentFolderId` in `$select` and drop the well-known non-received folders on the client.
>
> **Ve zkratce.** `GET /me/mailFolders/inbox/messages` vrací jen zprávy PŘÍMO v Doručené poště – e-mail, který pravidlo přesunulo do podsložky, v ní není. `GET /me/messages` je celá schránka včetně Odeslané, Konceptů a Odstraněné pošty. Pro přehled „co mi přišlo“ čti `/me/messages` s `parentFolderId` v `$select` a dobře známé složky, které přijatou poštou nejsou, vyřaď na klientovi.

## Symptom

An "awaiting reply" or "what came in today" widget works for most users, but someone who sorts mail with Outlook rules says the widget never shows the messages in their project folders. The opposite bug shows up in a "recent mail" feature built on `/me/messages`: the user's own sent replies are listed as if someone had sent them.

## Cause

- A folder's `messages` collection contains only the messages in that folder. Subfolders are separate `childFolders` with their own `messages` collections; the request does not recurse.
- `/me/messages` lists messages across the mailbox — every folder, including Sent Items, Drafts and Deleted Items.

Neither is "mail I received".

## Fix

1. Resolve the IDs of the folders that do not hold received mail, by their well-known names, once per page load:

   ```http
   GET /me/mailFolders/sentitems?$select=id
   GET /me/mailFolders/drafts?$select=id
   GET /me/mailFolders/deleteditems?$select=id
   GET /me/mailFolders/junkemail?$select=id
   GET /me/mailFolders/outbox?$select=id
   GET /me/mailFolders/archive?$select=id
   GET /me/mailFolders/conversationhistory?$select=id
   ```

   A folder that does not exist in a given mailbox (Archive often doesn't) returns an error — just don't exclude it.

2. Read the whole mailbox, newest first, with the folder of each message:

   ```http
   GET /me/messages?$select=id,subject,receivedDateTime,from,conversationId,parentFolderId
       &$orderby=receivedDateTime desc&$top=<3 × what you show>
   ```

   A date window works as `$filter=receivedDateTime ge 2026-11-05T00:00:00Z` — the filter property is the same as the `$orderby` property.

3. Drop messages whose `parentFolderId` is one of the IDs from step 1, then cut to the size you show. Take a larger sample than you need, because the excluded messages are removed only after the read.

4. **If Sent Items or Deleted Items could not be resolved** (network error, missing consent), fall back to `/me/mailFolders/inbox/messages` and don't cache that incomplete result. A narrower list is better than showing the user's own sent mail as received.

We filter on the client rather than with `parentFolderId ne '…'` on the server: combining `$filter` and `$orderby` on messages has its own rules and we have not verified `ne` on the folder there.

## When Inbox-only is right

Keep reading `/me/mailFolders/inbox/messages` when the feature **acts on the Inbox itself**. Examples are triage that archives messages, which must not pull mail out of folders a rule already sorted it into, and intake from a shared mailbox's Inbox. Write down which group each caller belongs to.
