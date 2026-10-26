---
title: Multi-line text in a document library stops at 255 characters
summary: "A REST MERGE stores 70k characters, but ValidateUpdateListItem rejects anything over 255 unless the column has UnlimitedLengthInDocumentLibrary – set it at creation or PATCH it later; lists are not affected"
tags: [lists, libraries, fields, rest-api, provisioning]
applies-to: SharePoint Online
last-reviewed: 2026-10-27
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

In a **list** (not a library) a Note column has no such cap.

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

- Read the current state with its own request: `$select=UnlimitedLengthInDocumentLibrary` on a field of another type returns 400. Don't put it into the request that checks whether a field exists, or a missing-property error will look like a missing field and you will create a duplicate.
- Changing the flag needs *Manage Lists*. Treat a 403 as "not done yet", not as success.
- Large values are still bounded by the 2 MB limit on a single REST request body.
