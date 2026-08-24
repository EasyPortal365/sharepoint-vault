---
title: FieldValuesAsText re-encodes underscores in JSON keys
tags: [rest-api, lists, fields, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-08-24
---

# FieldValuesAsText re-encodes underscores in JSON keys

> **Bottom line.** In `ListItemAllFields/FieldValuesAsText` responses, every underscore of the field's internal name comes back as `_x005f_` — `A_x0020_B` becomes `A_x005f_x0020_x005f_B`. Match keys by decoding `_x005f_` → `_`, or you will "lose" values for any column whose name contains a space or diacritic.
>
> **Ve zkratce.** V odpovědi `ListItemAllFields/FieldValuesAsText` se každé podtržítko interního názvu pole vrací jako `_x005f_` – z `A_x0020_B` je `A_x005f_x0020_x005f_B`. Klíče porovnávej po dekódování `_x005f_` → `_`, jinak „ztratíš" hodnoty všech sloupců, jejichž název vznikl z textu s mezerou nebo diakritikou.

## Symptom

You fetch formatted values for an item:

```http
GET /_api/web/getfilebyserverrelativeurl('/sites/x/Docs/report.docx')/ListItemAllFields/FieldValuesAsText
```

and look up your column by its internal name (`Document_x0020_Type`). The key is missing from the JSON — even though the column clearly has a value in the UI. Columns with simple names (`Category`) work fine.

## Cause

Internal names created from display names with spaces already contain OData-encoded sequences (`_x0020_` for a space). When `FieldValuesAsText` serialises the response, it encodes the *underscores of that encoding* once more: each `_` becomes `_x005f_`. Your `Document_x0020_Type` arrives as `Document_x005f_x0020_x005f_Type`.

## Fix

Normalise the response keys before matching:

```ts
const dict: { [k: string]: string } = {};
Object.keys(resp).forEach(k => {
  const v = resp[k];
  if (typeof v !== 'string') return;
  dict[k.toLowerCase()] = v;                                   // raw key
  dict[k.split('_x005f_').join('_').toLowerCase()] = v;        // decoded key
});
const value = dict[internalName.toLowerCase()] || '';
```

Keeping both the raw and the decoded key makes the lookup safe regardless of whether a given tenant/endpoint applies the re-encoding.

## Notes

- `FieldValuesAsText` is otherwise a great fit for read-only detail views: it returns display-ready strings for *every* field type, including person, lookup and managed metadata — types you cannot easily render from raw item values.
- The sibling endpoints `FieldValuesAsHtml` and `FieldValuesForEdit` show the same key encoding.
- Raw item reads (`/items?$select=Document_x0020_Type`) are *not* affected — the re-encoding is specific to the `FieldValues*` family.
