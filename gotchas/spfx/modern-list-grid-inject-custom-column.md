---
title: Injecting your own column into the modern list grid — rows are display:contents, cells carry explicit grid placement
tags: [spfx, modern-list, dom, css-grid, overlay]
applies-to: SharePoint Online (modern list/library view, 2026)
last-reviewed: 2026-08-12
---

# Adding a column to the modern list grid from SPFx

> **Bottom line.** A `<div>` appended to a `[role="row"]` lands in the wrong place and shifts the whole table — not because the grid is "too virtualized to touch", but because rows are `display: contents` and every real cell carries an **explicit** `grid-column` / `grid-row`. Add a track to the grid, set both properties on your own cells, push the trailing `addColumnCell_*` right, and it lays out exactly.
>
> **Ve zkratce.** `<div>` přidaný do `[role="row"]` se usadí špatně a rozhodí tabulku — ne proto, že by mřížka byla „moc virtualizovaná", ale protože řádky mají `display: contents` a každá skutečná buňka má **explicitní** `grid-column` / `grid-row`. Přidej mřížce dráhu, nastav své buňce obě vlastnosti a odsuň koncovou `addColumnCell_*` doprava — pak sedí přesně.

## Symptom

You want to draw an extra column into a document library — a preview of a column that does not exist yet, a computed badge, an annotation from your own app. You append one `<div>` per `[role="row"]`. Result: the header cell is missing, values appear one column to the left of where they should be, and an existing column gets overlapped. It reads like "the grid is virtualized, don't touch it".

## Cause

Measure the grid before concluding anything:

```js
const grid = document.querySelector('[role="grid"]');
getComputedStyle(grid).display;                    // "grid"
getComputedStyle(grid).gridTemplateColumns;        // "56px 40px 300px 110px ... 120px"

const row = grid.querySelectorAll('[role="row"]')[1];
getComputedStyle(row).display;                     // "contents"  ← the row draws nothing
row.getBoundingClientRect();                       // all zeros, for the same reason

const cell = row.children[2];
cell.getAttribute('style');
// "grid-row: inherit; grid-column: calc( 2 + var(--html-grid-num-column-offset) );"
```

Two facts follow:

1. Because rows are `display: contents`, the **cells** are the grid items — of one single grid that spans every row.
2. Cells are placed **explicitly**. Some use a plain number, some a `calc()` with a CSS variable, and `grid-row: inherit` picks the row index up from the row element.

A cell you append has neither property, so auto-placement drops it into the first free slot anywhere in the grid — usually a different visual row — and everything after it shifts.

## Fix

Only ever touch your own nodes, plus the one trailing cell:

```js
const CLS = 'my-ghost-cell';
const cols  = getComputedStyle(grid).gridTemplateColumns.split(' ');
const width = 260;
const firstTrack = cols.length;              // 1-based index of the track we take
// last track belongs to the "+ Add column" cell — insert ours in front of it
grid.style.gridTemplateColumns =
  cols.slice(0, -1).join(' ') + ` ${width}px ` + cols[cols.length - 1];

grid.querySelectorAll('[role="row"]').forEach(row => {
  const kids = row.children;
  if (!kids.length) return;
  const gridRow = getComputedStyle(kids[0]).gridRow;          // copy the row index
  const add = kids[kids.length - 1];
  if (/addColumnCell_/.test(add.className || '')) add.style.gridColumn = String(firstTrack + 1);

  const isHeader = /headerRow_/.test(row.className || '');
  const cell = document.createElement('div');
  cell.className = CLS;
  cell.style.cssText =
    `grid-column:${firstTrack};grid-row:${gridRow};` +
    // the new column is the right-most one, so pin it or nobody will scroll to it
    `position:sticky;right:0;` +
    // SP's own header cells are sticky with z-index:25 — be above it in the header
    // row and below it in data rows, or data cells ride over the header on scroll
    (isHeader ? 'top:0;z-index:26;' : 'z-index:3;') +
    'background:#E4F7F6;box-sizing:border-box;padding:8px 12px;overflow:hidden;';
  cell.textContent = isHeader ? 'My column' : valueFor(row);
  row.appendChild(cell);
});
```

Reading a row's identity (to match your data): the file name lives in
`row.querySelector('[class*="field-LinkFilename"]').textContent`.

## What else it has to handle

- **Re-renders.** Scrolling recycles rows, resizing and sorting rebuild them. Watch the grid with a `MutationObserver` (`childList`, `subtree`, plus `attributes` on `style`/`class`) and re-apply inside `requestAnimationFrame`, guarded by a flag so your own writes don't retrigger it.
- **Cleanup must be complete.** Remove your cells, clear the inline `gridTemplateColumns`, and clear `gridColumn` on `addColumnCell_*`. Reset foreign inline styles to empty rather than to a remembered value — let SharePoint set them again.
- **SPA navigation.** Moving to another library swaps the whole grid; your observer is then attached to a dead node. Unmount on navigation (`context.application.navigatedEvent` for an application customizer).
- **Don't insert in the middle.** Putting your column right after *Name* means rewriting `grid-column` on every cell to its right — values SharePoint sets inline, some as `calc()` with a CSS variable, all restored on the next render. Appending at the end plus `position: sticky` touches nothing but your own nodes.
- **Scrolling into view is not a substitute for sticky.** `scrollLeft` is clamped to `scrollWidth - clientWidth`, so on a wide library the appended column simply cannot be brought next to a right-hand panel.
- **Hook classes carry a build hash** (`headerRow_2da043bb`, `addColumnCell_6c7da25e`), so match with `[class*="headerRow_"]`. If the structure isn't what you expect, bail out and fall back to your own UI — treat the injected column as an enhancement, never as the only path.

## The meta-lesson

"I tried it and it broke" is not a diagnosis. The distance between *this cannot be done* and *I forgot `grid-column`* was one `getComputedStyle` call on a real cell. Before writing off someone else's UI as untouchable, measure how it is actually built — container display, item display, explicit vs. automatic placement. Virtualized grids are frequently the opposite of what they look like.
