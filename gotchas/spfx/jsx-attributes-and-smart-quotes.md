---
title: Typographic quotes in JSX attributes break the parser (TS1003)
tags: [spfx, typescript, react, localization]
applies-to: Any TypeScript/JSX codebase with localized strings
last-reviewed: 2026-07-16
---

# Typographic quotes in JSX attributes break the parser (TS1003)

> **Bottom line.** Typographic quotes inside a double-quoted JSX attribute end the attribute early and break the parser (TS1003) — put any quoted string into a JSX expression with single quotes: `{'…'}`.
>
> **Ve zkratce.** Typografické uvozovky v JSX atributu s dvojitými uvozovkami ukončí atribut předčasně a rozbijí parser (TS1003) – jakýkoli řetězec s uvozovkami dej do JSX výrazu se single-quote: `{'…'}`.

## Symptom

You paste properly typeset copy (German „…", Czech „…", French «…», or curly English "…") into a JSX attribute:

```tsx
<Header sub="Changes are saved when you click „Save"." />
```

The build fails with baffling errors pointing at the middle of your sentence:

> TS1003: Identifier expected.
> TS1382: Unexpected token. Did you mean `{'>'}`?

## Cause

The JSX attribute is delimited by ASCII `"…"`, and while the *typographic* quotes themselves are legal characters, real-world strings mix them with ASCII quotes (or the attribute's own delimiters collide with what a `-replace`/translation pipeline produced). The parser ends the attribute early and tries to read your prose as code. The failure is intermittent across strings, which makes it look like random corruption rather than a rule.

## Fix

Any attribute value containing typographic quotes goes into a **JSX expression with a single-quoted string**:

```tsx
<Header sub={'Changes are saved when you click „Save".'} />
```

Single quotes don't collide with any double-quote variant, and the expression form survives copy-paste from documents and translators untouched.

## Notes

- Adopt it as a blanket convention for localized UI strings — enforcing "expression form for any string with quotes" is cheaper than debugging TS1003 one string at a time.
- The same character class causes grief elsewhere: PowerShell 7 treats [smart quotes as string *delimiters*](../powershell/smart-quotes-are-string-delimiters.md) — your deployment scripts holding UI copy are the next place this bites.
