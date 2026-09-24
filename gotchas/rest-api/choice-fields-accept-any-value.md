---
title: Choice fields accept any value over REST — validation is a form-only illusion
tags: [rest-api, fields, data-quality]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# Choice fields accept *any* value over REST — validation is a form-only illusion

> **Bottom line.** A Choice field's allowed values are enforced only by SharePoint's browser forms — REST and CSOM write any raw string unchecked, so validate the vocabulary in your app layer and expect drift in existing data.
>
> **Ve zkratce.** Povolené hodnoty Choice pole vynucují jen prohlížečové formuláře SharePointu – REST a CSOM zapíšou jakýkoli řetězec bez kontroly, takže slovník validuj ve své aplikační vrstvě a počítej s rozjetými hodnotami ve stávajících datech.

## Symptom

You assume writing a value outside a Choice field's list will fail with 400 — so either you build defensive code for an error that never comes, or (worse) you discover months later that one column quietly holds **three different vocabularies**: the form wrote `In progress`, an import wrote `InProgress`, an old script wrote `Running`.

## Cause

The choices list and the *Allow fill-in* setting are enforced **only by SharePoint's own browser forms**. REST and CSOM write the raw string into the column with no validation whatsoever — any value, any casing, `FillInChoice` irrelevant.

Measured live (SharePoint Online, 2026-09-24) on a single-value Choice column with `FillInChoice: false`, writing a value that is not in `Choices` and reading the item back:

| Write path | Result | Stored value |
|---|---|---|
| `POST …/items` (plain JSON, with and without `OData-Version: 4.0`) | 201 | exactly as sent |
| `POST …/items(<id>)` with `X-HTTP-Method: MERGE` | 204 | exactly as sent |
| `POST …/items(<id>)/ValidateUpdateListItem` | 200, `HasException: false` | exactly as sent |
| `POST …/AddValidateUpdateItemUsingPath` | 200, `HasException: false`, item created | exactly as sent |

A known value in different casing (think `IN PROGRESS` for a defined `In progress`) was stored as sent, not normalized. A column with `FillInChoice: true` behaved the same. Even the `Validate…` endpoints, the ones SharePoint's own forms call, do not check the vocabulary.

**Multi-choice columns behave the same** (second live test, 2026-09-24): with `A` a defined choice and `C` not, both `["C"]` and `["A","C"]` were accepted — 201 under every header combination tried — and `AddValidateUpdateItemUsingPath` answered 200 without an error.

## Fix

Treat a Choice column as a **string column with a suggestion list**, and act accordingly:

1. **Enforce the vocabulary in your application layer** — validate before POST/PATCH; SharePoint won't do it for you.
2. **Expect drift in existing data** — group-bys, dashboards and conditional formatting must handle unknown/legacy values gracefully (an `Other` bucket beats a blank widget).
3. **Audit before you rely on it** — pull distinct values and diff them against the field definition:

   ```http
   GET /_api/web/GetList(@u)/items?$select=Status&$top=5000
   ```

   (distinct client-side — REST has no `$apply` here.)
4. **Mind the opposite trap:** if admins can *add* values in your app's UI, patch them into the field's `Choices` too — REST will happily write the new value, but SharePoint's own forms will refuse to save items until the field definition knows it.

## Notes

- Lookup fields are the opposite: they really do require a valid target item ID — don't generalize this gotcha to them.
- Multi-choice fields have the same non-validation (measured, see above), plus their own wire format quirks — test writes with real payloads.
- If a write of an unknown Choice value fails for you, the vocabulary is not the reason — look at the body format, a missing field or the headers. A 400 we once blamed on the value turned out to be unmeasured: [A Choice value your field does not know is stored anyway](../lists/choice-value-missing-from-the-field-is-stored-anyway.md).
