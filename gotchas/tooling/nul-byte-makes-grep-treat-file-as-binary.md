---
title: "A literal NUL byte makes ripgrep treat a source file as binary — a silent blind spot for every grep-based sweep"
tags: [tooling, grep, ripgrep, audits]
applies-to: any codebase (found in an SPFx project)
last-reviewed: 2026-07-18
---

# A literal NUL byte in a source file makes ripgrep treat it as binary — and every grep-based sweep silently skips it

## Symptom

- `grep`/`rg` on one specific `.ts` file prints `Binary file ... matches` instead of matching lines.
- Bulk find-and-replace sweeps, lint-adjacent scripts, drift checkers and even AI review agents that rely on content search **silently skip the file** — it becomes a blind spot nobody notices.
- The file compiles and runs perfectly fine; TypeScript and webpack don't care.

## Cause

The source file contains a **real U+0000 (NUL) character inside a string literal** — e.g. a composite map key like:

```ts
have[(row.Line || '') + '\u0000' + (row.Title || '')] = true;   // fine: escape sequence
```

written instead with the *actual* control character between the quotes. This typically happens when an editor,
script, or tool layer **decodes an escape sequence while writing the file** (you type `\u0000`, the file gets
the real byte). Ripgrep and GNU grep classify any file containing a NUL byte as binary and stop reporting
line matches for it.

## Fix

Replace the raw byte with the escape sequence — identical runtime semantics, plain-text file:

```js
// one-off repair (Node): rewrite NUL bytes as the 6-char escape "\u0000"
const fs = require('fs');
const buf = fs.readFileSync(file);
const esc = Buffer.from('\\u0000', 'utf8');
const out = [];
for (const b of buf) { if (b === 0) { for (const e of esc) out.push(e); } else out.push(b); }
fs.writeFileSync(file, Buffer.from(out));
```

## Prevention / detection

- Never put real control characters into source — always the escape (`'\u0000'`, `'\t'`, …).
- After any bulk tool-driven edit, sanity-check: `file src/**/*.ts` — a source file reported as `data`
  instead of `text` has the problem.
- If a code audit uses grep-style search, remember such files are invisible to it — read them directly.
