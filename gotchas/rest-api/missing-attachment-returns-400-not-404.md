---
title: A missing attachment returns 400, not 404 – an "is it there?" check by status code reads "not there" as a failure
short-title: Missing attachment is 400, not 404
summary: "`AttachmentFiles('name')` on a missing attachment returns 400 ArgumentOutOfRangeException; check existence from the attachment list"
tags: [rest-api, lists, attachments, error-handling]
applies-to: SharePoint Online
last-reviewed: 2026-10-27
---

# A missing attachment returns 400, not 404 – an "is it there?" check by status code reads "not there" as a failure

> **Bottom line.** `items(id)/AttachmentFiles('<name>')` on an item that has no attachment of that name returns **400 Bad Request** with `System.ArgumentOutOfRangeException` – both for the file metadata and for `/$value`. It does **not** return 404. Code that treats 404 as "not there yet" and every other error as a failure reports a read error the first time it runs. Check existence from the attachment list instead: `items(id)/AttachmentFiles?$select=FileName`.
>
> **Ve zkratce.** `items(id)/AttachmentFiles('<název>')` na položce, která přílohu toho názvu nemá, vrací **400 Bad Request** s `System.ArgumentOutOfRangeException` – u metadat souboru i u `/$value`. **Nevrací** 404. Kód, který bere 404 jako „ještě není“ a každou jinou chybu jako selhání, ohlásí při prvním běhu chybu čtení. Existenci zjišťuj z výpisu příloh: `items(id)/AttachmentFiles?$select=FileName`.

## Symptom

A common pattern keeps a small JSON state file (a map, a log) as an attachment of a list item and reads it back on the next run:

```ts
const r = await sp.get(itemUrl + "/AttachmentFiles('state.json')/$value", ...);
if (r.status === 404) return null;        // never happens
if (!r.ok) throw new Error('State file is unreadable (HTTP ' + r.status + ').');
```

On a fresh item the attachment does not exist yet, and the code reports "unreadable" instead of "none yet".

## Cause

SharePoint resolves the attachment by name in the item's attachment collection. A name that is not in the collection is an argument out of range, which the REST layer maps to 400. Measured on SharePoint Online on 27 October 2026, with the same result for `AttachmentFiles('<name>')` and `AttachmentFiles('<name>')/$value`.

## Fix

Read the attachment list first, then fetch the file only when it is there:

```ts
async function hasAttachment(sp: SPHttpClient, itemUrl: string, fileName: string): Promise<boolean> {
  const r = await sp.get(itemUrl + '/AttachmentFiles?$select=FileName', SPHttpClient.configurations.v1,
    { headers: { Accept: 'application/json;odata=nometadata' } });
  if (!r.ok) throw new Error('Attachments could not be read (HTTP ' + r.status + ').');
  const d = await r.json() as { value?: Array<{ FileName?: string }> };
  return (d.value || []).some(a => (a.FileName || '').toLowerCase() === fileName.toLowerCase());
}
```

Keep the list read strict: a failed read is not the same as "no attachment". Treating it as "none" would let the next save overwrite state you could not read.

The same check decides between overwriting an existing attachment (`PUT` to its `$value`) and adding a new one (`AttachmentFiles/add`).

## Related

- [Adding an attachment changes the item's ETag](adding-an-attachment-changes-the-item-etag.md)
