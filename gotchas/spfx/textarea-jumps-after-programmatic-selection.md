---
title: "A textarea jumps after you change its text from code and restore the selection"
summary: focus() scrolls the page to the element and, in Chromium, setSelectionRange scrolls the textarea to the end of the selection; restore the selection with focus({ preventScroll }) and put scrollTop back
tags: [spfx, react, dom, scrolling, textarea]
applies-to: Any browser, SPFx web parts and plain React apps with an editable textarea
last-reviewed: 2026-11-08
---

# A textarea jumps after you change its text from code and restore the selection

> **Bottom line.** After replacing part of a textarea's text from code, restoring the selection with `el.focus()` + `el.setSelectionRange(a, b)` moves the view twice: `focus()` scrolls the page to the element and, as we saw in Chromium, `setSelectionRange` scrolls the textarea so the end of the selection is visible. Remember `scrollTop`, call `focus({ preventScroll: true })`, set the selection, and put `scrollTop` back.
>
> **Ve zkratce.** Když z kódu nahradíš část textu v textaree a výběr obnovíš přes `focus()` + `setSelectionRange`, pohled se posune dvakrát: `focus()` posune stránku k prvku a v Chromiu `setSelectionRange` posune textareu na konec výběru. Zapamatuj si `scrollTop`, zavolej `focus({ preventScroll: true })`, nastav výběr a `scrollTop` vrať.

## Symptom

An editor lets the user select a passage and run an action on it (rewrite, shorten, replace). Your code swaps the selected text for the new one and selects the new passage so the user sees what changed. Every time, the view jumps — to the end of the document, or the page scrolls so the textarea's top edge is at the screen top. When you stream the new text in chunks, it jumps with every chunk.

## Cause

- `HTMLElement.focus()` without options scrolls the nearest scrolling ancestor so the element is in view.
- In Chromium (our observation; the MDN page for `setSelectionRange()` does not mention scrolling), `setSelectionRange()` scrolls the textarea's own content so the selection end (the caret) is visible.
- Putting the saved `scrollTop` back also undoes any other scroll change made by the text replacement itself.

## Fix

```ts
export function selectKeepingScroll(ta: HTMLTextAreaElement, start: number, end: number): void {
  const top = ta.scrollTop;
  try { ta.focus({ preventScroll: true }); } catch { /* focus is a convenience */ }
  try { ta.setSelectionRange(start, end); } catch { /* highlight only */ }
  ta.scrollTop = top;
}
```

When the text arrives in chunks, do not restore the selection after every chunk. Mark the changing passage some other way (an overlay behind the textarea) and set the selection once, at the end.

## Related

- [`window.scrollTo` does nothing in an SPFx web part on a modern page](window-scrollto-does-nothing-on-modern-page.md)
