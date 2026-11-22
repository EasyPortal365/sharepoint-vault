---
title: Word add-in — undoing your own tracked changes when TrackedChange has no id
short-title: Word — undo own tracked changes (no ids)
summary: "Ctrl+Z after a multi-batch Word add-in write needs several presses and works only with the cursor in the document text; to offer your own Undo, snapshot body.getTrackedChanges() before and after and identify changes by type, author and date, comparing text per group, because a comment over a paragraph can split an existing change into pieces"
tags: [office-add-ins, word, office-js, tracked-changes]
applies-to: Word on the web (WordApi 1.6), Office.js task pane add-ins that write with Track Changes on
last-reviewed: 2026-11-22
---

# Word add-in: undoing your own tracked changes when `TrackedChange` has no id

> **Bottom line.** An add-in that writes a suggestion over several `context.sync()` calls creates several undo steps. Ctrl+Z only acts when the cursor is in the document text, not in the task pane. To give users a reliable "Undo" button, snapshot the tracked changes and comment ids before and after the write. `Word.TrackedChange` has no id, so identify a change by **type, author and date**. Compare its text per group, not per item. A comment inserted over a whole paragraph can split an older tracked change into several pieces.
>
> **Ve zkratce.** Zápis doplňku přes víc `sync()` = víc kroků Zpět a Ctrl+Z funguje jen s kurzorem v textu. Vlastní vrácení: snímek sledovaných změn a id komentářů před a po zápisu; změnu poznávej podle typu, autora a času, text porovnávej po skupinách (komentář přes odstavec rozdělí starší změnu na kusy).

## Symptoms

- After a large suggestion, Ctrl+Z seems to do nothing. The focus is in the task pane or on a comment card.
- A before/after diff keyed on the full signature (type, author, date, text) reports that older changes were modified, even though only comments were added.

## What works

```ts
const snap = async (ctx: Word.RequestContext) => {
  const tc = ctx.document.body.getTrackedChanges();   // WordApi 1.6
  const cs = ctx.document.body.getComments();         // WordApi 1.4
  tc.load('items/type,items/author,items/date,items/text');
  cs.load('items/id');
  await ctx.sync();
  return {
    changes: tc.items.map((c) => ({ key: `${c.type}|${c.author}|${new Date(c.date).getTime()}`, text: c.text })),
    comments: cs.items.map((c) => c.id),
  };
};
// Group by key and join the texts in document order. Keys only in "after" are yours.
// If an older group's joined text changed, your write touched someone else's change:
// do not offer your own undo (rejecting would also remove their edit).
// To undo: reject() every change whose key is yours, delete() every new comment id.
```

- Offer the button only when every operation is a text replace, an inserted paragraph or a comment. Leave styles, lists and footnotes to Ctrl+Z.
- A change without a date cannot be told apart safely. In that case do not offer the button.

## Why

Tracked changes carry no stable identifier in Office.js, and Word re-splits runs when range markers such as comment anchors are inserted. The pieces keep the original author and timestamp, so the joined text per (type, author, date) stays the same while the item list changes.
