---
title: Upload a generated image as a list item attachment (no file picker)
short-title: Upload a generated image as a list item attachment
summary: Canvas charts, placeholder banners, QR codes — `AttachmentFiles/add` takes a raw `ArrayBuffer`; the item must exist first
tags: [rest-api, spfx, attachments, javascript]
applies-to: SharePoint Online
last-reviewed: 2026-09-25
---

# Upload a generated image as a list item attachment

> **Bottom line.** `AttachmentFiles/add` takes a raw `ArrayBuffer` as the request body, so anything your page can draw — a canvas chart, a placeholder banner, a QR code — can be attached to a list item without ever touching a file picker. The main catch: the item must already exist.
>
> **Ve zkratce.** `AttachmentFiles/add` bere jako tělo požadavku přímo `ArrayBuffer`, takže cokoli stránka nakreslí (graf z canvasu, ukázkový banner, QR kód) jde připnout k položce seznamu bez dialogu pro výběr souboru. Hlavní past: položka už musí existovat.

## Why you want this

Sample/demo data that looks real, generated report images, chart snapshots saved next to the record, placeholder visuals for a content editor — all the cases where the bytes are produced in the browser and there is nothing to pick from disk.

## The call

```
POST /_api/web/lists/getbytitle('MyList')/items(123)/AttachmentFiles/add(FileName='banner.png')
Accept: application/json
body: <ArrayBuffer>
```

No `Content-Type` juggling, no multipart. Send the buffer as the body and you are done.

```js
async function attach(webUrl, listTitle, itemId, fileName, buffer, spHttpClient, config) {
  // Apostrophes inside an OData string literal are doubled BEFORE encoding —
  // encodeURIComponent leaves ' alone, so a file called "Karel's.png" would break the URL.
  const safe = fileName.split("'").join("''");
  const url = `${webUrl}/_api/web/lists/getbytitle('${listTitle}')/items(${itemId})`
            + `/AttachmentFiles/add(FileName='${encodeURIComponent(safe)}')`;
  const res = await spHttpClient.post(url, config, { headers: { Accept: 'application/json' }, body: buffer });
  if (!res.ok) throw new Error(`Attachment upload failed [${res.status}]: ${await res.text()}`);
}
```

## Canvas → `ArrayBuffer`

`canvas.toBlob()` gives a `Blob` and `await blob.arrayBuffer()` gives the bytes — `Blob.arrayBuffer()` is a DOM API declared in TypeScript's `lib.dom`, so it type-checks in SPFx 1.22 even though `lib` stops at ES2015. The data-URL route is synchronous and needs no `await`:

```js
function canvasToArrayBuffer(canvas) {
  const dataUrl = canvas.toDataURL('image/png');         // "data:image/png;base64,iVBORw0K..."
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buffer;
}
```

Same trick works for any base64 payload you already hold (a data URI pasted by the user, a base64 blob from an API).

## Gotchas

**The item must exist first.** Attachments hang off an item id, so on a "new record" form the files have nowhere to go. Queue them in memory (keep `URL.createObjectURL(file)` for the thumbnail), create the item, then upload — and revoke the object URLs afterwards. Make the queued state *visible*; a file that silently waits looks like a failed upload.

**Do not let an attachment failure roll back the record.** Wrap each upload in its own `try/catch`, save the record regardless, and report which files did not make it by name. The text is the valuable part; the banner is not worth losing it.

**Prefer PNG over SVG for anything you intend to render back in a page.** SVG is smaller and tempting for generated graphics, but depending on the tenant's *Browser File Handling* setting SharePoint serves it with `Content-Disposition: attachment`, so an `<img src=...>` pointing at the attachment renders nothing. PNG is served inline everywhere.

**Deleting is a POST, not a DELETE verb.**

```
POST .../AttachmentFiles/getByFileName('banner.png')
X-HTTP-Method: DELETE
```
Accept `204` as success alongside `200`.

**File names are the identity.** There is no attachment id — the name is the key. If your feature stores which attachment belongs where (say, one visual per channel), store **names**, not server-relative URLs: a site move or library rename invalidates the URL, the name survives. Re-uploading the same name replaces the file.

## Related

- [Read all items from a large list — paging done right](get-all-list-items-paged.md)
- [Check another user's effective permissions](check-another-users-effective-permissions.md)
