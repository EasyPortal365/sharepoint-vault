---
title: A decimal comma erases a Number column — `Number('7,25')` is NaN, JSON sends `null`, SharePoint answers 204
tags: [rest-api, number-field, forms, localization, json, silent-data-loss]
applies-to: SharePoint Online (REST writes from any client that builds the body with JSON.stringify, SPFx included)
last-reviewed: 2026-09-24
---

# A decimal comma erases a Number column — `Number('7,25')` is NaN, JSON sends `null`, SharePoint answers 204

> **Bottom line.** In a locale that writes a decimal comma, a text input holding `7,25` turned into a number with `Number()` becomes `NaN`, and `JSON.stringify` silently turns `NaN` into `null`. SharePoint accepts `null` for a (non-required) Number column: the write returns **204** and the column is **emptied**, so an edit erases the value the item already had. Parse user input with a comma-aware helper and reject `NaN` before you build the body.
>
> **Ve zkratce.** V prostředí s desetinnou čárkou dá `Number('7,25')` z textového pole `NaN` a `JSON.stringify` z `NaN` potichu udělá `null`. SharePoint `null` u (nepovinného) Number sloupce přijme: zápis vrátí **204** a sloupec **vyprázdní**, takže úprava smaže hodnotu, kterou položka už měla. Vstup od člověka čti helperem, který zná čárku, a `NaN` odmítni dřív, než skládáš tělo.

## Symptom

- A form field such as "budget (hours)", "price" or "payment terms (days)" is saved without any error, but the column stays empty.
- Worse on edit: the item had a value, the user typed `7,5`, pressed Save, saw no error — and the stored value is gone.
- It happens only to people who type a comma, a space as a thousands separator (`1 000`) or anything non-numeric (`14 days`).

## Cause

Three steps, none of which raises an error:

1. The input is a plain text field (`<input>` without `type="number"`, often chosen on purpose because, depending on the browser and its locale, a number input may reject the comma).
2. The code converts it with `Number(value)`. `Number('7,25')` is `NaN`. (`parseFloat` fails differently: `parseFloat('7,25')` is `7` and `parseFloat('14 days')` is `14` — no `NaN`, no `null`, just a silently wrong number.)
3. `JSON.stringify({ Budget: NaN })` produces `{"Budget":null}`. SharePoint REST treats `null` as "clear this field".

Measured on SharePoint Online (MERGE on a list item, `application/json;odata=nometadata` for both `Accept` and `Content-Type`; a non-required Number column, shown here as `Budget`):

| Body sent | Status | Value read back |
|---|---|---|
| `{"Budget":7.25}` | 204 | `7.25` |
| `JSON.stringify({ Budget: Number('7,25') })` → `{"Budget":null}` | 204 | `null` |
| `{"Budget":0}` | 204 | `0` |

TypeScript does not help: `NaN` is a `number`.

## Fix

Parse the text yourself and refuse what is not a number:

```ts
/** Empty = 0, comma or dot as decimal separator, spaces as thousands separators; NaN = reject. */
export function parseDecimal(s?: string | null): number {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
  if (!t) return 0;
  const v = Number(t);
  return isFinite(v) ? v : NaN;
}

const budget = parseDecimal(form.budget);
if (isNaN(budget)) { setError('Enter the budget as a number, e.g. 7,25.'); return; }
await updateItem(id, { Budget: budget });
```

- Decide what an **empty** field means (0 or "clear") explicitly. Don't let it fall out of `NaN`.
- For display, format with the same precision you store. `toFixed(1)` shows 7.25 as "7.3", and quarter hours end up rounded in reports and exports.

## Notes

- `<input type="number">` never yields `NaN`, but it does not save you either: an entry the browser cannot parse reads back as `''`, and `Number('')` is `0` — so an edit silently writes `0` over the stored value (the last row of the table). Check `input.validity.badInput` and handle `''` explicitly. Whether a comma is accepted at all depends on the browser and its locale.
- Values from a `<select>` (item ids) are safe to pass through `Number()`. The risk is free text typed by a person.
- Quick review check: search for `Number(` and `parseFloat(` applied to form state that is bound to a text input, and for request bodies that could carry `NaN`.
- Related: [Silent catch-to-empty fallbacks + destructive writes = data loss](silent-fallbacks-poison-destructive-writes.md). Same family: a quiet `null` or empty value reaching a write that overwrites.
