---
title: Created/Modified on a document library won't stick — and the API says 200 while ignoring you
tags: [lists, document-library, rest-api, metadata, dates]
applies-to: SharePoint Online
last-reviewed: 2026-08-13
---

# Backdating documents: Created/Modified and the two ways it silently fails

> **Bottom line.** A plain `MERGE` on the list item accepts `Created`/`Modified` and returns `204`, then SharePoint overwrites both with "now". The only path that sticks is `ValidateUpdateListItem` with `bNewDocumentUpdate: true` — and it wants a **locale-formatted** date (`8/6/2026 9:00 AM`), not ISO. Feed it ISO and you get **HTTP 200 with a per-field `HasException`**, so a status-code check reports success.
>
> **Ve zkratce.** Obyčejný `MERGE` položky `Created`/`Modified` přijme, vrátí `204` a SharePoint je pak stejně přepíše na „teď". Jediná cesta, která drží, je `ValidateUpdateListItem` s `bNewDocumentUpdate: true` – a chce datum v **lokálním formátu** (`8/6/2026 9:00 AM`), ne ISO. Na ISO odpoví **HTTP 200 a `HasException` u pole**, takže kontrola stavového kódu hlásí úspěch.

## Symptom

You upload demo or migrated documents and want their timeline to look real, so you set
`Created` and `Modified` per item. Every call returns `204 No Content`. Read the items back
and every date is today.

## Cause

For a document library the item's `Modified` is driven by the file, and an ordinary item
update recomputes it after applying your field values. `Created`/`Modified` are only honoured
on the "new document" code path, which REST exposes through `ValidateUpdateListItem` with
`bNewDocumentUpdate: true` (the same switch that suppresses a new version and keeps the
existing `Editor`).

## Fix

```js
await fetch(`${web}/_api/web/GetList('${listRel}')/items(${id})/ValidateUpdateListItem`, {
  method: 'POST',
  headers: { Accept: 'application/json;odata=nometadata',
             'Content-Type': 'application/json;odata=nometadata',
             'X-RequestDigest': digest },
  body: JSON.stringify({
    formValues: [
      { FieldName: 'Modified', FieldValue: '8/6/2026 9:00 AM' },
      { FieldName: 'Created',  FieldValue: '8/6/2026 9:00 AM' }
    ],
    bNewDocumentUpdate: true
  })
});
```

## The part that bites twice

`ValidateUpdateListItem` **never fails with an HTTP error for bad field values.** It returns
`200` and a `value` array with one entry per field; the failed ones carry
`HasException: true` and an `ErrorMessage`. With ISO (`2026-08-06T09:00:00Z`) you get:

> You must specify a valid date within the range of 1/1/1900 and 12/31/8900.

…while your code happily logs "16 items updated". Always inspect the result:

```js
const res = await r.json();
const failed = (res.value || []).filter(v => v.HasException);
if (failed.length) throw new Error(failed.map(v => `${v.FieldName}: ${v.ErrorMessage}`).join('; '));
```

The date format follows the **web's locale**, not ISO 8601 — on an English-locale site
`M/D/YYYY h:mm AM`. This applies to every field you push through `ValidateUpdateListItem`,
not just dates: it takes display-formatted strings, not the raw values `MERGE` expects.

## Rule

Two different write paths, two different value formats, and one of them reports success it
did not achieve. When a write "succeeds" but the value is not what you asked for, read the
value back before believing the status code — and for anything going through
`ValidateUpdateListItem`, treat `HasException` as the real status.
