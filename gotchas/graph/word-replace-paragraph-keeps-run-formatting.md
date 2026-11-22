---
title: Word add-in — rewriting a paragraph drops bold, italics and links inside it
short-title: Word — keep inline formatting when rewriting a paragraph
summary: "Paragraph.insertText(text, 'Replace') keeps the paragraph style but writes plain runs, so bold passages, italics and hyperlinks inside the paragraph are lost (for example in a translation); read the inline formatting from body.getOoxml(), carry it through the rewrite as markers, then search only inside the range insertText returned and set font.bold, font.italic and hyperlink on the found passages"
tags: [office-add-ins, word, office-js, tracked-changes, formatting]
applies-to: Word on the web (WordApi 1.3+), Office.js task pane add-ins that rewrite whole paragraphs
last-reviewed: 2026-11-22
---

# Word add-in: rewriting a paragraph drops bold, italics and links inside it

> **Bottom line.** `paragraph.insertText(newText, Word.InsertLocation.replace)` keeps the paragraph style (a heading stays a heading) but the new text is plain: bold passages, italics and hyperlinks inside the paragraph are gone. To keep them, read the inline formatting first from **one** `body.getOoxml()`, carry it through the rewrite (for example as `<b>`, `<i>`, `<a href="#N">` markers for a translation model), write the plain text, then **search only inside the range that `insertText` returned** and set `font.bold`, `font.italic` and `hyperlink` on the found passages.
>
> **Ve zkratce.** Přepis odstavce přes `insertText(…, replace)` nese styl odstavce, ale ne tučné, kurzívu a odkazy uvnitř. Formátování přečti z `body.getOoxml()`, přenes ho značkami, po zápisu hledej úseky jen ve vráceném rozsahu a nastav `font.bold` / `font.italic` / `hyperlink`.

## Symptoms

- After a whole-document translation written paragraph by paragraph, `document.xml` shows the new text in `w:ins` without any `w:b` and without `w:hyperlink` or HYPERLINK fields.
- The paragraph style survived, so headings look right and the loss is easy to miss.

## Fix

1. **Read the formatting once.** `context.document.body.getOoxml()` returns a flat OPC package. Take the hyperlink relationships (`Type` ending in `/hyperlink`) and walk the `w:body` paragraphs in order. Skip `w:del` and `w:moveFrom` (with tracked changes your paragraph text is the "changes accepted" version) and paragraphs inside `w:txbxContent`, which are not in `body.paragraphs`. Links come as `w:hyperlink r:id` and also as `HYPERLINK "url"` fields (`w:fldSimple` or `w:fldChar`/`w:instrText`).
2. **Pair by text, not only by position.** Compare each OOXML paragraph's text with the text you read from `body.paragraphs` (whitespace-normalised). If it differs, treat that paragraph as unformatted rather than guessing.
3. **Write plain, then format the returned range.**

```ts
const range = paragraph.insertText(plain, Word.InsertLocation.replace);
await context.sync();
for (const run of runs) {                       // { start, end, bold?, italic?, link? }
  const part = plain.slice(run.start, run.end); // max 255 chars – Word search limit
  const k = occurrenceIndex(plain, part, run.start); // which non-overlapping match
  const hits = range.search(part.replace(/\^/g, '^^'), { matchCase: true });
  hits.load('items');
  found.push({ run, hits, k });
}
await context.sync();
for (const { run, hits, k } of found) {
  const h = hits.items[k];
  if (!h) continue;                             // report it, do not fail the write
  if (run.bold) h.font.bold = true;
  if (run.italic) h.font.italic = true;
  if (run.link) h.hyperlink = run.link;         // WordApi 1.3
}
await context.sync();
```

Search the **returned range**, not the paragraph. With Track Changes on, the paragraph still contains the deleted old text, and names or numbers that did not change would match there first.

## What you get with Track Changes on

- New runs inside `w:ins` with `w:b w:val="1"` / `w:i w:val="1"`, and a `w:rPrChange` recording the format change.
- Links written by `range.hyperlink = url` show up as `HYPERLINK "url"` **fields**, not as `w:hyperlink` elements.
- Rejecting the tracked changes written by the add-in restores the original paragraph with its original formatting.

## Watch out

- Only set formatting **on**. Setting `font.bold = false` on the rest of the paragraph would also override bold that comes from the paragraph style (headings).
- If a language model moves the markers, it can wrap a neighbouring word. Tell it that each marker must wrap exactly the translation of the text it wraps in the original, and show the user which passages get formatted before they approve.
- Keep link URLs out of the model's text (pass `#1`, `#2` and map back). Only re-apply `http(s):` and `mailto:` targets.
