---
title: justify-content:center inside overflow:hidden clips content you can never scroll to
tags: [spfx, css, mobile, layout]
applies-to: Any web UI (bites hardest in mobile webviews)
last-reviewed: 2026-07-16
---

# `justify-content: center` inside `overflow: hidden` clips content you can never scroll to

## Symptom

A centered landing/empty-state screen (logo, welcome text, action buttons stacked vertically) looks great on desktop. On a phone, the bottom of the stack — typically the most important control — is **cut off, and no amount of scrolling brings it back**. It reads like "the app's height is broken", and no height fix helps.

## Cause

Three CSS facts conspiring:

1. The container centers with `justify-content: center` and sits inside a parent with `overflow: hidden` (a common app-shell pattern).
2. On a small screen the stacked content becomes **taller than the container**. With `justify-content: center`, the overflow is split **both ways — including upward**, and scroll containers cannot scroll above their top edge. Even with `overflow-y: auto`, the top part would be unreachable.
3. Flex children default to `flex-shrink: 1`, so before clipping you often get a phase of silently squashed children, which hides the problem longer.

## Fix

Swap centering for **flexible spacers** and make the container scroll:

```css
.landing {
  display: flex;
  flex-direction: column;
  overflow-y: auto;              /* was: hidden on an ancestor */
}
.landing::before,
.landing::after { content: ''; flex: 1 0 0; }   /* centering "springs" */
.landing > * { flex-shrink: 0; }                /* children scroll, not squash */
```

When content fits, the springs center it exactly like `justify-content: center`. When it doesn't, they collapse to zero and the container scrolls normally from the very top.

## Notes

- Anything `position: absolute` pinned inside the now-scrolling container (a corner menu button) will scroll away with the content — switch it to `position: sticky`.
- Why it ships so often: desktop screens are tall enough that the "content taller than container" branch never runs in development. Test empty states at mobile heights, not just widths.
