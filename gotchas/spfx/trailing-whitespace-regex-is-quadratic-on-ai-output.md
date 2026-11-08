---
title: "A trailing-whitespace regex freezes the page when it parses AI output"
summary: /\s+$/ and lazy (.+?)\s*$ are quadratic on a line with a long run of spaces that does not end the line; text from an AI model or a foreign document is untrusted input, so trim with trimEnd() and anchor captures on a non-space character
tags: [spfx, javascript, regex, performance, ai, security]
applies-to: Any JavaScript that parses model output or foreign text line by line – SPFx web parts, extensions, Azure Functions in Node
last-reviewed: 2026-11-08
---

# A trailing-whitespace regex freezes the page when it parses AI output

> **Bottom line.** `line.replace(/\s+$/, '')` and captures like `/^(.+?)\s*$/` look harmless, but on a line with a long run of spaces followed by something else they take time proportional to the square of the run. In Node 24 a line of `a` + 40 000 spaces + `b` took about 2.5 s for the replace and 2.1 s for the lazy capture; `trimEnd()` took under 1 ms. Text from an AI model is untrusted input – a prompt injection in a document or e-mail can make the model emit such a line – and a parser that runs on every streamed token freezes the page. Use `trimEnd()` / `trim()`, anchor captures on a non-space (`^(\S.*)$` after trimming), and add a test with a 40 000-space line.
>
> **Ve zkratce.** `replace(/\s+$/, '')` a `^(.+?)\s*$` jsou na řádku s dlouhým během mezer, za kterým ještě něco je, kvadratické: v Node 24 trval řádek „a“ + 40 000 mezer + „b“ asi 2,5 s, resp. 2,1 s, `trimEnd()` pod 1 ms. Výstup AI je nedůvěryhodný vstup a parser, který běží na každý token streamu, zamrzne stránku. Ořezávej přes `trimEnd()`, zachycení ukotvi na nemezerovém znaku a přidej test s řádkem o 40 000 mezerách.

## Symptom

A web part renders an AI answer while it streams and parses it line by line (custom blocks, tables, key–value lines). Normal answers are fast. One answer with an odd line – a long run of spaces in the middle, for example copied from a badly formatted document – makes the tab unresponsive for seconds on every update.

## Cause

For `/\s+$/` the engine tries every position inside the run of spaces as a start, reads the rest of the run and then finds that the line does not end there, because `b` follows. That is n starts × up to n characters = O(n²). A lazy `(.+?)\s*$` does the same from the other side: for every length of the captured part it rescans the remaining spaces.

Measured in Node 24 on the line `'a' + ' '.repeat(40000) + 'b'`:

| Code | Time |
|---|---|
| `s.replace(/\s+$/, '')` | ≈ 2 556 ms |
| `/^(.+?)\s*$/.exec(s)` | ≈ 2 140 ms |
| `s.trimEnd()` | < 1 ms |
| `s.trimEnd().match(/^(\S.*)$/)` | < 1 ms |

## Fix

```js
// Before – quadratic on long space runs that do not end the line
const clean = line.replace(/\s+$/, '');
const m = /^(.+?)\s*$/.exec(line);

// After – linear
const clean = line.trimEnd();          // or a manual loop if your TS lib target lacks trimEnd
const m = /^(\S.*)$/.exec(clean);      // capture anchored on a non-space, on trimmed text
```

- Check markers at the end of a cell (`{+}`, `[1]`) on the already trimmed text with an anchored test, not with a pattern that allows optional spaces before `$`.
- When you find one such regex, review every regex in the same module that runs on the same text.
- Add a test: feed a 40 000-character space run through every parser and export path and assert it stays under ~50 ms of CPU time (`process.cpuUsage`). Wall-clock limits flake when tests run in parallel.

## Why it matters for AI features

Model output is shaped by whatever the model read: documents, e-mails, web pages. Treat it like any other untrusted input – escape it for HTML, and make sure your parsers cannot be slowed down by it.
