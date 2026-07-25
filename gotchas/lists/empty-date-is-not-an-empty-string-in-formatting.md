---
title: An empty Date field is not `''` — blank dates render as overdue
tags: [lists, column-formatting, view-formatting]
applies-to: SharePoint Online
last-reviewed: 2026-07-25
---

# An empty Date field is not `''` — blank dates render as overdue

> **Bottom line.** `@currentField == ''` does not detect an empty Date/Time field, so every item without a date falls through to the "past due" branch and lights up red — test emptiness with `.displayValue`, written as `@currentField.displayValue` in column formatting and `[$FieldName.displayValue]` in row formatting.
>
> **Ve zkratce.** `@currentField == ''` u prázdného pole typu Datum neplatí, takže každá položka bez data propadne do větve „po termínu" a zčervená – prázdnotu testuj přes `.displayValue`, a to zápisem `@currentField.displayValue` v column formattingu a `[$FieldName.displayValue]` v row formattingu.

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

Test emptiness on `.displayValue`, which *is* reliably `''` when the field is empty — but **reach for it differently in column and row formatting**, because the two contexts don't accept the same syntax.

**Column formatting** — use `@currentField.displayValue`:

```jsonc
"iconName":   "=if(@currentField.displayValue == '', '', if(@now > @currentField, 'Warning', 'Accept'))",
"txtContent": "=if(@currentField.displayValue == '', '—', toLocaleDateString(@currentField))",
"style": {
  "display": "=if(@currentField.displayValue == '', 'none', 'inline')"
}
```

`[$ReviewDate.displayValue]` — the bracket form — **does not resolve here**, even for the column's own field. It yields no value, `== ''` is `false`, and you land back in the "overdue" branch with the bug apparently unfixed.

**Row / view formatting** — the bracket form is the one that works, since there is no "current field":

```jsonc
"additionalRowClass": "=if([$ReviewDate.displayValue] == '', '', if(@now > [$ReviewDate], 'sp-css-backgroundColor-errorBackground', ''))"
```

In both contexts `.displayValue` is only for the *emptiness test* — keep the raw field reference for the *date arithmetic*, because `.displayValue` is a locale-formatted string and useless for comparison.

## Notes

- Bracket references use the **internal** name (`[$ReviewDate…]`), not the display name — a rename otherwise silently reverts the fix.
- The column/row syntax split is the easy half-fix to miss: patch the row formatter alone and the rows stop turning red while the column keeps showing a warning icon, which reads like a caching problem rather than a second bug.
- Verify with a deliberately blank item. A test set where every row has a date will never surface this, and it is invisible in the formatting pane's preview.
- The same "empty is not `''`" caution applies to Person and Lookup fields, where `.displayValue`/`.title` are likewise the dependable emptiness tests.
- In **view** formatting, mind that `<` and `&` can't be used at all — see [View formatting JSON can't contain `<` or `&`](view-formatter-rejects-angle-bracket-and-ampersand.md). The reversed comparisons above are written that way on purpose.
