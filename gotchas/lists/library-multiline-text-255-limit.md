---
title: Multi-line text in a document library stops at 255 characters
summary: "A REST MERGE stores 70k characters, but ValidateUpdateListItem rejects anything over 255 unless the column has UnlimitedLengthInDocumentLibrary – set it at creation or PATCH it later"
tags: [lists, libraries, fields, rest-api, provisioning]
applies-to: SharePoint Online
last-reviewed: 2026-11-03
---

# Multi-line text in a document library stops at 255 characters

> **Bottom line.** A *Multiple lines of text* (Note) column in a **document library** is capped at 255 characters unless `UnlimitedLengthInDocumentLibrary` is on. A plain REST `MERGE` ignores the cap, so your app works – until something writes through `ValidateUpdateListItem` and the long value is rejected. Turn the flag on when you create the column, or `PATCH` it onto the existing one; nothing gets truncated by switching it on.
>
> **Ve zkratce.** Sloupec *Více řádků textu* (Note) v **knihovně dokumentů** má strop 255 znaků, dokud nemá zapnuté `UnlimitedLengthInDocumentLibrary`. Obyčejný REST `MERGE` strop obejde, takže appka funguje – dokud něco nezapisuje přes `ValidateUpdateListItem` a dlouhá hodnota se neodmítne. Zapni příznak při založení sloupce, nebo ho dodatečně nastav `PATCH`em; zapnutím se nic nezkrátí.

## Symptom

An app stores a JSON document (a parsing result, a configuration, a snapshot) in a Note column of a library. Writes through `/items(n)` with `MERGE` succeed even with tens of thousands of characters, and reads return the full value.

The same column rejects a long value written through `ValidateUpdateListItem`:

```
ErrorCode: -2146232832
ErrorMessage: This field can have no more than 255 characters.
```

The value is not saved. Any tool or form that goes through that path fails to save the item.

## Measured (SharePoint Online, 2026-10)

A temporary library got three Note columns. Each was written with a 1,008-character value through `ValidateUpdateListItem`:

| Column | Result |
|---|---|
| created without the flag | rejected, error above, value empty |
| created with `UnlimitedLengthInDocumentLibrary: true` in the `POST /fields` body | saved, 1,008 characters read back |
| created without the flag, then `PATCH`ed to `true` | saved, 1,008 characters read back |

The test covered a library only; a Note column in a list was not measured. The flag name says it is a library setting.

## Fix

At creation (OData v4 headers, e.g. `Accept: application/json`, `Content-Type: application/json`):

```http
POST /_api/web/GetList(@u)/fields?@u='/sites/demo/Docs'
{
  "@odata.type": "#SP.FieldMultiLineText",
  "FieldTypeKind": 3,
  "Title": "MyJson", "StaticName": "MyJson", "InternalName": "MyJson",
  "NumberOfLines": 6, "RichText": false,
  "UnlimitedLengthInDocumentLibrary": true
}
```

On an existing column (returns 204):

```http
PATCH /_api/web/GetList(@u)/fields/getbyinternalnameortitle('MyJson')?@u='/sites/demo/Docs'
IF-MATCH: *
{ "@odata.type": "#SP.FieldMultiLineText", "UnlimitedLengthInDocumentLibrary": true }
```

The `odata=nometadata` variant of the `POST /fields` body with `@odata.type` returned 400 in the same test – use the OData v4 headers above.

## Watch out

- Reading the flag is safe on any field (re-measured 2026-11-03): `$select=UnlimitedLengthInDocumentLibrary` on a Text field returns 200 with the property simply left out, and on the whole `/fields` collection it returns 200 too (164 fields of many types, with `nometadata`, plain `application/json`, `verbose` and OData v4 headers alike). What does return 400 is `getbyinternalnameortitle('X')` for a column that **does not exist** ("Column X does not exist"), with or without the `$select`. So don't build an existence check on a 404 – a missing column is a 400 here, and treating 400 as "some other error" makes you skip creating it, while treating every 400 as "missing" can create a duplicate when the 400 has another cause.
- Changing a column definition needs permission to manage the list. If the `PATCH` fails, treat the column as "not done yet", not as success, and retry on the next provisioning run.
- Large values are still bounded by the 2 MB limit on a single REST request body.
