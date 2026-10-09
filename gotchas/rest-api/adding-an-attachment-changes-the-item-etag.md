---
title: Adding an attachment changes the item's ETag – the next MERGE with the old ETag fails with 412
short-title: Attachment add changes the ETag
summary: "`AttachmentFiles/add` bumps the item version; re-read before an `IF-MATCH` update"
tags: [rest-api, lists, attachments, concurrency]
applies-to: SharePoint Online
last-reviewed: 2026-10-09
---

# Adding an attachment changes the item's ETag – the next MERGE with the old ETag fails with 412

> **Bottom line.** `AttachmentFiles/add` is a change to the list item: it bumps the item's version and `@odata.etag`. If you then update the item with `IF-MATCH` set to the ETag you read before the upload, SharePoint rejects it with **412 Precondition Failed**. Re-read the item after the upload and continue with the new ETag.
>
> **Ve zkratce.** `AttachmentFiles/add` je změna položky: zvedne její verzi i `@odata.etag`. Když pak položku upravíš s `IF-MATCH` nastaveným na ETag z doby před nahráním, SharePoint to odmítne s **412 Precondition Failed**. Po nahrání položku znovu přečti a pokračuj s novým ETagem.

## Symptom

A common pattern: upload a photo as an attachment, then store its file name in a field of the same item.

```ts
const item = await getItem(id);                        // ETag "3"
await addAttachment(id, 'odometer-1a2b.jpg', bytes);   // item is now ETag "4"
await update(id, { PhotoFile: 'odometer-1a2b.jpg' }, item.etag);  // IF-MATCH: "3" → 412
```

The update fails with **412 Precondition Failed**, and the UI typically tells the user that *someone else* changed the record – although nobody did. The attachment stays on the item, but the field that should point to it is never written, so a retry leaves an orphaned file behind.

## Cause

Adding an attachment is a change to the list item, and the item's ETag changes with it. The ETag your code holds from the initial read is therefore stale the moment the upload succeeds, and optimistic concurrency does exactly what it should: it refuses the write.

## Fix

Re-read the item after the upload and use its fresh ETag for the following update:

```ts
await addAttachment(id, name, bytes);
const fresh = await getItem(id);                       // new ETag
await update(id, { PhotoFile: name }, fresh.etag);
```

A clean way is to make the upload helper return the fresh item, so no caller can forget the re-read.

## Notes

- Don't "fix" it with `IF-MATCH: *`. That throws away the protection against two devices (phone and desktop) overwriting each other's changes – the reason the ETag is there in the first place.
- Treat every other write to the same item that happens between your read and your MERGE the same way: re-read before you update with `IF-MATCH`.
