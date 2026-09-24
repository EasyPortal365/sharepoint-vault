---
title: "`stopPropagation` in `onClick` does not stop the keyboard — a clickable row swallows Enter and Space of the buttons inside it"
tags: [spfx, react, accessibility, keyboard, lists, ux]
applies-to: React UIs (SPFx web parts included) with a clickable row, card or tile that handles Enter/Space and contains its own buttons or checkboxes
last-reviewed: 2026-09-24
---

# `stopPropagation` in `onClick` does not stop the keyboard — a clickable row swallows Enter and Space of the buttons inside it

> **Bottom line.** A row that opens its detail on click and on Enter/Space (`role="button"`, `tabIndex={0}`, `onKeyDown`) also receives the `keydown` events of every button and checkbox inside it, because keyboard events bubble. Wrapping the inner controls in `onClick={e => e.stopPropagation()}` stops the *click*, not the key. If the row's handler calls `preventDefault()`, the inner button never fires and the detail opens instead; if it does not, both actions run. Handle the key only when it belongs to the row: `if (e.target !== e.currentTarget) return;`.
>
> **Ve zkratce.** Řádek, který otevírá detail klikem i Enterem/mezerníkem (`role="button"`, `tabIndex={0}`, `onKeyDown`), dostává i `keydown` všech tlačítek a zaškrtávátek uvnitř, protože klávesové události bublají. Obal `onClick={e => e.stopPropagation()}` zastaví *klik*, ne klávesu. Když obsluha řádku volá `preventDefault()`, vnitřní tlačítko se nestiskne a místo něj se otevře detail; když ho nevolá, proběhne obojí. Klávesu obsluhuj jen tehdy, když patří řádku: `if (e.target !== e.currentTarget) return;`.

## Symptom

Everything works with the mouse. From the keyboard, in the same rows:

- Tab to **Delete** in a settings table, press Enter → the edit panel for that row opens; nothing is deleted.
- Space on the **selection checkbox** in a catalogue or ticket list → the item's detail opens instead of toggling the checkbox.
- Enter on **Send reminder** or **Add to Outlook** inside a card → the card's detail opens; the reminder is not sent.
- A hand-written variant without `preventDefault`: Enter on a count link inside a category card ran **both** actions (edit the category *and* jump to its list), and "Open and acknowledge" opened the document **twice**.

Measured across one codebase: the shared row helper lacked the check in 10 of its copies, and the defect was live in 12 rows of 7 applications — plus hand-written copies of the same handler in several cards and tiles that a search for the helper's name never found.

## Cause

```tsx
<div role="button" tabIndex={0}
     onClick={open}
     onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
  <span>{item.title}</span>
  <span onClick={e => e.stopPropagation()}>          {/* stops click only */}
    <button onClick={() => remove(item)}>Delete</button>
  </span>
</div>
```

1. Focus is on the **Delete** button. Enter produces a `keydown` whose target is the button.
2. The event bubbles — React's synthetic events follow the DOM — and reaches the row's `onKeyDown`, which has no idea the key was meant for somebody else.
3. The row calls `preventDefault()`. For a button, pressing Enter or Space *is* the default action that produces its click, so the button never activates. The row opens its detail.

The `stopPropagation` wrapper was written for the mouse and never sees a `keydown`. Without `preventDefault` in the row handler, step 3 runs the detail **and** lets the button's default action happen: two actions from one key press.

## Fix

Let the container react only to keys pressed on the container itself:

```tsx
export function rowLinkProps(open: () => void, title: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    title,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return;            // the key belongs to an inner control
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    }
  };
}
```

Test it with real, bubbling events on the **inner** element, and assert both halves:

```tsx
const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
act(() => { innerButton.dispatchEvent(ev); });
expect(opened).toBe(0);                  // the row did not open
expect(ev.defaultPrevented).toBe(false); // the button's own action still happens
```

…plus Enter and Space on the row itself (opens, `defaultPrevented === true`) and a key inside a text input in the row (untouched). Remove the `target` check and the inner-element cases must fail — in our suites three of nine did.

## Notes

- **Search by shape, not by name.** A search for the helper finds the helper. The same handler written by hand on a card, a tile or a list item is the same defect; look for `onKeyDown` handling Enter/Space on anything that is not a form field and does not compare `target` with `currentTarget`.
- The click version of the trap is separate and more familiar: a button in a row without `stopPropagation` runs its action *and* opens the row.
- The check fixes the keyboard, not the semantics: interactive elements nested inside `role="button"` remain an accessibility compromise. A button inside a `<button>` is invalid HTML and a different defect.
