---
title: Word add-in — Paragraph.text includes text deleted in tracked changes
short-title: Word — Paragraph.text includes deleted tracked text
summary: "In a document with tracked changes, Word's `Paragraph.text` also returns runs marked as deleted, so an AI or diff working from it sees both versions; read `getReviewedText('Current')` (WordApi 1.4) instead and trim the trailing paragraph mark"
tags: [office-add-ins, word, office-js, tracked-changes]
applies-to: Word on the web (WordApi 1.4+ seen), Office.js task pane add-ins that read paragraph text from documents with tracked changes
last-reviewed: 2026-11-22
---

# Word add-in: `Paragraph.text` includes text deleted in tracked changes

> **Bottom line.** In a Word document with tracked changes, `paragraphs.load('items/text')` returns the inserted text and the text marked as deleted, joined together. If your add-in sends that text to a language model or computes a diff from it, the deleted wording looks current. A model then "fixes" text someone already removed, or proposes to bring it back. Read `paragraph.getRange('Whole').getReviewedText('Current')` (WordApi 1.4) instead. It returns the paragraph as if all changes were accepted. Trim the trailing `\r`.
>
> **Ve zkratce.** Ve Wordu se sledovanými změnami vrací `Paragraph.text` i text označený jako smazaný, slepený s vloženým. Model nebo výpočet rozdílu pak bere smazané znění jako platné a navrhuje ho vrátit. Čti `getRange('Whole').getReviewedText('Current')` (WordApi 1.4) – znění se změnami přijatými – a ořízni koncový `\r`.

## Symptoms

- A "before" preview of a paragraph shows a sentence that is struck through in the document, right after the new wording.
- An AI rewrite proposes text that matches a deletion someone made earlier.
- A word-level diff between the read text and the proposed text is much larger than the visible change.

## What works

```ts
await Word.run(async (ctx) => {
  const paras = ctx.document.body.paragraphs;
  paras.load('items/text');
  await ctx.sync();
  // Only when the document has tracked changes, and only with WordApi 1.4.
  const results = paras.items.map((p) =>
    p.getRange(Word.RangeLocation.whole).getReviewedText(Word.ChangeTrackingVersion.current));
  await ctx.sync();
  const current = results.map((r) => r.value.replace(/[\r\n]+$/, ''));
  // Use `current` for the model and for any diff; keep p.text for matching the selection.
});
```

- Check `Office.context.requirements.isSetSupported('WordApi', '1.4')` first, and fall back to `Paragraph.text` without it.
- Compute any "changed span" for a targeted rewrite from the same `current` text, not from `Paragraph.text`.
- The selection's paragraphs (`getSelection().paragraphs`) come back in the same raw form, so match them against the raw `Paragraph.text`, not against `current`.
- Tell the model which version of the text it is reading, and list the tracked changes to it separately (for example from `body.getTrackedChanges()`, WordApi 1.6).

## Why

`Paragraph.text` reflects the document's markup, not the reviewed result. Tracked deletions remain in the paragraph's runs until someone accepts them, so they show up in the text.
