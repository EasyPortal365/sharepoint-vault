---
title: A formatter that returns its raw input is a hole in your escaping
tags: [security, xss, html, escaping, reporting]
applies-to: SharePoint Online, SharePoint Server, SPFx, any HTML generator
last-reviewed: 2026-09-18
---

# A formatter that returns its raw input is a hole in your escaping

> **Bottom line.** You can escape every value at every call site and still ship stored XSS, because one *formatting* helper returns the input unchanged on its unhappy path. Escaping belongs inside any function whose output reaches HTML — not only at the places that obviously handle user text.
>
> **Ve zkratce.** Můžete escapovat každou hodnotu na každém místě a stored XSS tam přesto je, protože jedna *formátovací* funkce vrací v nešťastné větvi vstup beze změny. Escapovat se musí uvnitř každé funkce, jejíž výstup teče do HTML – ne jen tam, kde je na první pohled uživatelský text.

## Symptom

An app generates a printable report (compliance pack, invoice, export preview) by building an HTML string and opening it in a new window. A code review shows the file is disciplined: every interpolation goes through `esc()`. Yet a value typed by an ordinary user ends up executing in the report.

## Cause

The one path to the sink that skipped `esc()` was a date formatter:

```ts
function fmtDay(iso: string | null): string {
  if (!iso) return '-';
  const d = iso.slice(0, 10).split('-');
  return d.length === 3
    ? Number(d[2]) + '. ' + Number(d[1]) + '. ' + d[0]
    : iso;                                   // <- the whole raw input, unbounded
}
```

Three things line up:

1. **The happy branch looks harmless.** With a real date it returns numbers, so nobody reads it as a sink.
2. **The unhappy branch returns the input verbatim** — not the 10 characters it sliced, the entire string.
3. **The value was never validated for shape.** The parser that loaded it checked `typeof value === 'string'` and nothing else, so "is it a date?" was never asked.

A fourth detail decides whether the payload is even reachable: an "is it expired?" test compared **strings**, `until < today`. `'<img …'` starts with `U+003C`, which sorts above `'2'`, so the record looked valid and was rendered instead of being marked expired.

## Why the window matters

`window.open('', '_blank')` followed by `document.write(html)` produces an `about:blank` document that **inherits the opener's origin**. Script in that document runs against the host site with the signed-in user's session — it is not a sandbox.

## Rules

1. **Escape inside the function whose output reaches HTML.** Callers see `fmtDay(x)` and reasonably assume a formatter formats.
2. **Read every branch, not the obvious one.** "I do not understand this input, so I will return it unchanged" is the most common shape of this hole.
3. **Validate shape at the boundary where data enters your model.** A date should be a date in the parser; `typeof === 'string'` is not validation. Reject or drop the record — do not carry an unvalidated value forward.
4. **String comparison of dates is only safe on a validated shape.** Otherwise a semantic test silently becomes a test of character order.
5. **Treat list content as untrusted even when the list is "internal".** If any site member can write the column, its content is user input.

## Checklist for a generated-HTML file

- Every helper that returns `string` into the template — does each of its branches escape?
- Any `slice`, `trim`, `toLocaleDateString`, `padStart` wrapper that can fall through to the original value?
- Is the value's shape enforced where it is parsed, or only where it is displayed?
- Does the report open in a document that inherits your origin?
