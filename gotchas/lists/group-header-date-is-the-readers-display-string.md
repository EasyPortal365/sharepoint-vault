---
title: A date in a group header is the reader's display string, not a date
short-title: Group header date = reader's display string
summary: "`@group.fieldData` of a Date field is text in the reader's locale; reformat only when the shape matches"
tags: [lists, view-formatting, grouping]
applies-to: SharePoint Online
last-reviewed: 2026-10-05
---

# A date in a group header is the reader's display string, not a date

> **Bottom line.** When a view is grouped by a Date field, `@group.fieldData` in `groupProps.headerFormatter` is the already-formatted text in the *reader's* locale (`05.10.2026` for a Czech reader), not a date value — so `getDate()`/`getMonth()` do not apply; reshape it with string functions only after checking the shape, and fall back to the raw text otherwise.
>
> **Ve zkratce.** Ve view seskupeném podle data je `@group.fieldData` v `groupProps.headerFormatter` hotový text v locale *čtenáře* (u českého čtenáře `05.10.2026`), ne datum – `getDate()`/`getMonth()` na něj nefungují; přeformátuj ho řetězcovými funkcemi až po kontrole tvaru a jinak nech původní text.

## Symptom

A grouped "by meeting date" view shows group headers like `Schůzka 05.10.2026` — readable, but not the house style (`5. 10. 2026`). Applying the usual row-formatter recipe (`getDate([$Field]) + '. ' + (getMonth([$Field]) + 1) + ...`) to `@group.fieldData` produces garbage or nothing.

## Cause

Group header data comes from the rendered group, not from an item: `@group.fieldData` carries the field's display value as text, formatted for whoever is looking at the page (observed: `05.10.2026` for a Czech-locale reader). Readers with other regional settings should be expected to get a different shape — hence the shape check below rather than fixed positions alone.

## Fix

Reformat only when the text has the shape you expect, and keep the raw value otherwise (`s` stands for `toString(@group.fieldData)`):

```jsonc
"txtContent": "=if(indexOf(s, '.') == 2 && lastIndexOf(s, '.') == 5, toString(Number(substring(s, 0, 2))) + '. ' + toString(Number(substring(s, 3, 5))) + '. ' + substring(s, 6, 10), s)"
```

`Number()` drops the leading zeros (`05` → `5`). Do not test the length with `length()` — it counts array elements, not characters ([details](formatting-length-is-for-arrays-not-strings.md)).

## Notes

- For the group of items with no date, keep a fallback label, but do not rely on `== ''` without testing it on your list: on rows an empty Date field is not `''` ([details](empty-date-is-not-an-empty-string-in-formatting.md)).
- `@group.count` is a number; pluralize with plain comparisons (`== 1`, `> 4`).
