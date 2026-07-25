---
title: An empty Date field is not `''` — blank dates render as overdue
tags: [lists, column-formatting, view-formatting]
applies-to: SharePoint Online
last-reviewed: 2026-07-25
---

# An empty Date field is not `''` — blank dates render as overdue

> **Bottom line.** `@currentField == ''` does not detect an empty Date/Time field, so every item without a date falls through to the "past due" branch and lights up red — test emptiness with `[$FieldName.displayValue] == ''` instead.
>
> **Ve zkratce.** `@currentField == ''` u prázdného pole typu Datum neplatí, takže každá položka bez data propadne do větve „po termínu" a zčervená – prázdnotu testuj přes `[$FieldName.displayValue] == ''`.

## Symptom

A deadline column formatted with the usual three-state logic:

```jsonc
"iconName": "=if(@currentField == '', '', if(@now > @currentField, 'Warning', 'Accept'))",
"txtContent": "=if(@currentField == '', '—', toLocaleDateString(@currentField))"
```

Items that genuinely *have* a date render correctly. Items with an **empty** date show a warning icon and no text at all — and with matching row formatting, the whole row goes red as if it were badly overdue. There is no error anywhere; it just renders wrong.

## Cause

For an empty Date/Time field, `@currentField` is not the empty string, so `@currentField == ''` is `false` and evaluation continues into the else branch. There, the empty value coerces to a timestamp at/near the epoch, which makes `@now > @currentField` `true` — every blank date is "overdue by 56 years".

The `txtContent` looks empty for the same reason: it takes the else branch too, and `toLocaleDateString()` of the empty value yields `''` rather than the `—` you wrote.

This bites hardest on optional deadline columns, where "no date" is a normal, common state — meeting notes, templates and presentations legitimately have no review date, and they are exactly the rows that turn red.

## Fix

Test emptiness on `.displayValue`, which *is* reliably `''` when the field is empty:

```jsonc
"iconName":   "=if([$ReviewDate.displayValue] == '', '', if(@now > @currentField, 'Warning', 'Accept'))",
"txtContent": "=if([$ReviewDate.displayValue] == '', '—', toLocaleDateString(@currentField))",
"style": {
  "display": "=if([$ReviewDate.displayValue] == '', 'none', 'inline')"
}
```

The same guard belongs in row formatting, or blank-dated rows keep their red background:

```jsonc
"additionalRowClass": "=if([$ReviewDate.displayValue] == '', '', if(@now > [$ReviewDate], 'sp-css-backgroundColor-errorBackground', ''))"
```

Note that `[$Field.displayValue]` is used for the *emptiness test* while `@currentField` stays for the *date arithmetic* — `.displayValue` is a locale-formatted string and is useless for comparison.

## Notes

- Reference the field by internal name (`[$ReviewDate.displayValue]`), not display name — a rename otherwise silently reverts the fix.
- Verify with a deliberately blank item. A test set where every row has a date will never surface this, and it is invisible in the formatting pane's preview.
- The same "empty is not `''`" caution applies to Person and Lookup fields, where `.displayValue`/`.title` are likewise the dependable emptiness tests.
- In **view** formatting, mind that `<` and `&` can't be used at all — see [View formatting JSON can't contain `<` or `&`](view-formatter-rejects-angle-bracket-and-ampersand.md). The reversed comparisons above are written that way on purpose.
