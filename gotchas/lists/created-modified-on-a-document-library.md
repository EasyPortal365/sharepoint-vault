---
title: Created/Modified on a document library won't stick — and the API says 200 while ignoring you
short-title: Created/Modified on a document library
summary: A plain MERGE reports 204 and SharePoint overwrites both with "now"; `ValidateUpdateListItem` + `bNewDocumentUpdate` is the only path that holds, it wants the web's locale format (the error message tells you which) and reads it in the web's regional time zone, not the browser's
tags: [lists, document-library, rest-api, metadata, dates, timezone]
applies-to: SharePoint Online
last-reviewed: 2026-10-22
---

# Backdating documents: Created/Modified and the two ways it silently fails

> **Bottom line.** A plain `MERGE` on the list item accepts `Created`/`Modified` and returns `204`, then SharePoint overwrites both with "now". The only path that sticks is `ValidateUpdateListItem` with `bNewDocumentUpdate: true` — and it wants a **locale-formatted** date (`8/6/2026 9:00 AM`), not ISO. Feed it ISO and you get **HTTP 200 with a per-field `HasException`**, so a status-code check reports success.
>
> **Ve zkratce.** Obyčejný `MERGE` položky `Created`/`Modified` přijme, vrátí `204` a SharePoint je pak stejně přepíše na „teď“. Jediná cesta, která drží, je `ValidateUpdateListItem` s `bNewDocumentUpdate: true` – a chce datum v **lokálním formátu** (`8/6/2026 9:00 AM`), ne ISO. Na ISO odpoví **HTTP 200 a `HasException` u pole**, takže kontrola stavového kódu hlásí úspěch.

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

## Same path for list items – and don't hard-code the date format

The same call backdates **ordinary list items** too (verified on custom lists with item-level
permissions: 100+ items in one run, each `Created` read back as the requested day). Do not hard-code
`M/D/YYYY h:mm AM`: derive the format from the web, because a non-English site parses a
different order and separator.

```js
const rs = await (await fetch(`${web}/_api/web/RegionalSettings?$select=DateFormat,DateSeparator,Time24`,
  { headers: { Accept: 'application/json;odata=nometadata' } })).json();
// DateFormat: 0 = M/D/Y, 1 = D/M/Y, 2 = Y/M/D
const [y, m, d] = '2026-08-06'.split('-').map(Number);
const parts = rs.DateFormat === 1 ? [d, m, y] : rs.DateFormat === 2 ? [y, m, d] : [m, d, y];
const time = rs.Time24 ? '9:00' : '9:00 AM';
const value = parts.join(rs.DateSeparator || '/') + ' ' + time; // e.g. "6.8.2026 9:00" on a Czech site
```

## Let the error message name the format

Sending the wrong shape is not a dead end — the per-field `ErrorMessage` differs depending on
*how* wrong it is, and one of the two variants hands you the answer:

| what you send | message |
|---|---|
| ISO (`2026-10-22T00:03:13Z`) | `You must specify a valid date within the range of 01.01.1900 and 31.12.8900.` |
| a wrong locale order (`10/22/2026 2:03 AM` on a Czech site) | **`Enter a date and time like this: 23.02.2012 14:25`** |

The second message is a worked example in the site's own format. When a date is rejected and
you are not sure of the order, separator or clock, send something deliberately in the wrong
order once and read the shape out of the reply.

## The time zone is the web's, not the browser's (measured 2026-10-22)

The string has no offset in it, so SharePoint has to pick a zone — and it picks the **web's
regional time zone**, not the caller's. Format the value from the browser's clock and the date
lands, silently, hours away from what you meant:

- a document whose `Modified` was `2026-10-22T00:03:13Z`
- formatted with `Date#getHours()` in a UTC+2 browser → `22.10.2026 2:03`
- the site's regional zone is Pacific (UTC-7), so it was stored as `2026-10-22T09:03:00Z`

Nine hours out — exactly the distance between the two zones. The write *worked*; the
conversion did not. That is an easy thing to misread as "this cannot be done", because the
value you read back is in the right field and simply on the wrong point of the axis.

Do not compute the offset yourself (DST makes that a second bug). Ask SharePoint to convert:

```js
const r = await fetch(
  `${web}/_api/web/regionalsettings/timezone/utctolocaltime(@d)?@d='${encodeURIComponent(iso)}'`,
  { method: 'POST', headers: { Accept: 'application/json;odata=nometadata',
                               'X-RequestDigest': digest } });
const local = (await r.json()).value;   // "2026-10-22T02:03:13" in the web's zone
```

Then feed `local` into the locale format derived above. One more detail: a format without
seconds throws the seconds away, so compare what you read back **to the minute**, or send a
value that carries seconds.

## Rule

Two different write paths, two different value formats, one of them reports success it
did not achieve — and even when it does write, the value is interpreted somewhere you did not
choose. When a write "succeeds" but the value is not what you asked for, read the
value back before believing the status code — and for anything going through
`ValidateUpdateListItem`, treat `HasException` as the real status.
