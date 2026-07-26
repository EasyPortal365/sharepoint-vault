---
title: Formatting `length()` is for arrays — on a string it wrecks the expression
tags: [lists, column-formatting, view-formatting]
applies-to: SharePoint Online
last-reviewed: 2026-07-26
---

# Formatting `length()` is for arrays — on a string it wrecks the expression

> **Bottom line.** In list-formatting expressions `length()` counts array elements, not characters — feed it a string and the surrounding arithmetic collapses (typically into a negative `substring` index), so the whole `txtContent` renders empty; get a string's length as `indexOf(str + '^', '^')` with a sentinel that cannot occur in the data.
>
> **Ve zkratce.** Ve formátovacích výrazech `length()` počítá prvky pole, ne znaky – na řetězci se okolní aritmetika zhroutí (typicky do záporného indexu `substring`) a celý `txtContent` se vykreslí prázdný; délku řetězce získáš jako `indexOf(str + '^', '^')` se sentinelem, který se v datech nemůže vyskytnout.

## Symptom

Stripping the file extension from a name, the "obvious" way:

```jsonc
"txtContent": "=substring([$FileLeafRef], 0, length([$FileLeafRef]) - length([$File_x0020_Type]) - 1)"
```

The element renders **empty** on every item. No error anywhere — the formatter saves, the rest of the card renders, just this text is blank.

## Cause

Per the formatting syntax reference, `length` "returns the number of elements in an array". Strings are not arrays here; the call does not return the character count, the subtraction produces a nonsense (negative) end index, and `substring` with a negative bound yields `''`.

This differs from every mainstream expression language a developer carries in muscle memory, which is what makes it a trap: the expression *looks* obviously correct, and nothing flags it.

## Fix

Derive length from `indexOf` over the string with a sentinel appended at the end:

```jsonc
"=indexOf([$FileLeafRef] + '^', '^')"
```

The sentinel's first occurrence is the one you appended, so its index *is* the string's length. Extension-stripping then works as:

```jsonc
"txtContent": "=substring([$FileLeafRef], 0, indexOf([$FileLeafRef] + '^', '^') - indexOf([$File_x0020_Type] + '^', '^') - 1)"
```

Pick a sentinel that cannot appear in the data (`'^'` is a reasonable default for file names; `'.'` is **not** — see Notes).

## Notes

- The same sentinel idiom fixes "is the string empty/whole-string operations" cases where you'd otherwise reach for `length()`.
- Related trap avoided by the sentinel: truncating at the *first* `'.'` (`indexOf(name, '.')`) butchers names with dots in the middle ("Analýza – 1. pololetí.xlsx" → "Analýza – 1").
- A number-to-string trim variant of the same idiom: `substring(toString(n) + '.', 0, indexOf(toString(n) + '.', '.'))` cuts the decimal part of a computed number (useful because `toFixed()` does not exist in formatting either — it renders as literal text).
- When the expression drives `txtContent`, failure is a blank text; when it drives an attribute, expect harsher outcomes ([non-web `href` drops the element](formatter-href-non-web-protocol-drops-element.md)).
