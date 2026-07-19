---
title: PowerShell 7 treats typographic quotes as string delimiters
tags: [powershell, encoding, localization]
applies-to: PowerShell 7 (and Windows PowerShell 5.1)
last-reviewed: 2026-07-16
---

# PowerShell 7 treats typographic quotes as string *delimiters*

> **Bottom line.** PowerShell's parser treats typographic quotes (`„ " ' '`) as string delimiters, so localized text ends the string mid-sentence and breaks the parse — put any prose with curly quotes into a single-quoted here-string `@'…'@`.
>
> **Ve zkratce.** Parser PowerShellu bere typografické uvozovky (`„ " ' '`) jako oddělovače řetězců, takže lokalizovaný text ukončí řetězec uprostřed věty a rozbije parsování – jakoukoli prózu s kudrnatými uvozovkami vlož do single-quoted here-stringu `@'…'@`.

## Symptom

A script assembles localized text (release notes, issue bodies, e-mail copy):

```powershell
$body = "After clicking „Reserve vehicle" the driver sees a banner…"
```

and dies with a parser error in the middle of the sentence:

> ParserError: Unexpected token 'Reserve' in expression or statement.

Replacing one kind of curly quote with another doesn't help.

## Cause

PowerShell's parser accepts **Unicode typographic quotes as string delimiters**, equivalent to their ASCII cousins:

- `"` (U+201C), `"` (U+201D), `„` (U+201E) all behave like `"`
- `'` (U+2018), `'` (U+2019) behave like `'`

So a double-quoted string containing `„` ends right there, and the rest of your prose is parsed as code. Any language whose typography uses these marks (German, Czech, and curly-quoted English from Word) triggers it.

## Fix

Text with typographic quotes goes into a **single-quoted here-string** — fully verbatim, no interpolation, no escaping, newlines included:

```powershell
$body = @'
After clicking „Reserve vehicle" the driver sees a banner…

Shipped in 1.2.0.
'@
```

(The closing `'@` must start at column 0.)

## Notes

- A plain single-quoted `'…'` string also tolerates the double-quote family — but has no escape for newlines, so multi-line text gets ugly fast. Here-strings are the habit worth building.
- If the text needs variable interpolation, interpolate *around* the verbatim parts (`$intro + $body`) rather than switching the body to `@"…"@`.
- Related, same character family, different tool: [typographic quotes in JSX attributes](../spfx/jsx-attributes-and-smart-quotes.md).
