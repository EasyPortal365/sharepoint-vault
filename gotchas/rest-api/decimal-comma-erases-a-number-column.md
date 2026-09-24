---
title: A decimal comma erases a Number column — `Number('7,25')` is NaN, JSON sends `null`, SharePoint answers 204
tags: [rest-api, number-field, forms, localization, json, silent-data-loss]
applies-to: SharePoint Online (REST writes from any client that builds the body with JSON.stringify, SPFx included)
last-reviewed: 2026-09-24
---

# A decimal comma erases a Number column — `Number('7,25')` is NaN, JSON sends `null`, SharePoint answers 204

> **Bottom line.** In a locale that writes a decimal comma, a text input holding `7,25` turned into a number with `Number()` becomes `NaN`, and `JSON.stringify` silently turns `NaN` into `null`. SharePoint accepts `null` for a Number column: the write returns **204** and the column is **emptied**, so an edit erases the value the item already had. Parse user input with a comma-aware helper and reject `NaN` before you build the body.
>
> **Ve zkratce.** V prostředí s desetinnou čárkou dá `Number('7,25')` z textového pole `NaN` a `JSON.stringify` z `NaN` potichu udělá `null`. SharePoint `null` u Number sloupce přijme: zápis vrátí **204** a sloupec **vyprázdní**, takže úprava smaže hodnotu, kterou položka už měla. Vstup od člověka čti helperem, který zná čárku, a `NaN` odmítni dřív, než skládáš tělo.

## Symptom

- A form field such as "budget (hours)", "price" or "payment terms (days)" is saved without any error, but the column stays empty.
- Worse on edit: the item had a value, the user typed `7,5`, pressed Save, got a success message — and the stored value is gone.
- It happens only to people who type a comma (or anything non-numeric, like `14 days`), so it rarely shows up in testing.

## Cause

Three steps, none of which raises an error:

1. The input is a plain text field (`<input>` without `type="number"`, often chosen on purpose because a number input rejects the comma in some locales).
2. The code converts it with `Number(value)` (or `parseFloat` without a check). `Number('7,25')` is `NaN`.
3. `JSON.stringify({ Budget: NaN })` produces `{"Budget":null}`. SharePoint REST treats `null` as "clear this field".

Measured on SharePoint Online (MERGE on a list item, `application/json;odata=nometadata`):

| Body sent | Status | Value read back |
|---|---|---|
| `{"Budget":7.25}` | 204 | `7.25` |
| `JSON.stringify({ Budget: Number('7,25') })` → `{"Budget":null}` | 204 | `null` |

TypeScript does not help: `NaN` is a `number`.

## Fix

Parse the text yourself and refuse what is not a number:

```ts
/** Empty = 0, comma or dot as decimal separator, spaces as thousands separators; NaN = reject. */
export function parseDecimal(s?: string | null): number {
  const t = String(s ?? '').replace(/[\s ]/g, '').replace(',', '.');
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

- `<input type="number">` avoids the problem, because the browser normalises the value and returns `''` for invalid input, so `Number('')` is `0`, not `NaN`. The trade-off is that some locales won't accept a comma in it.
- Values from a `<select>` (item ids) are safe to pass through `Number()`. The risk is free text typed by a person.
- Quick review check: search for `Number(` and `parseFloat(` applied to form state that is bound to a text input, and for request bodies that could carry `NaN`.
- Related: [Silent fallbacks poison destructive writes](silent-fallbacks-poison-destructive-writes.md). Same family: a quiet `null` or empty value reaching a write that overwrites.
