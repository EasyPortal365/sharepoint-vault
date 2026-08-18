---
title: A Promise wrapped around img.onload can hang forever — try/catch won't save you
tags: [spfx, browser, canvas, svg, promise, testing]
applies-to: Any browser code that wraps an image, canvas or postMessage callback in a Promise
last-reviewed: 2026-08-18
---

# A `Promise` wrapped around `img.onload` can hang forever — `try/catch` won't save you

> **Bottom line.** `img.onload`/`onerror` are not guaranteed to fire. Wrap them in a Promise with no
> timeout and the Promise never settles — so the caller's `try/catch` (and its reassuring "best-effort"
> comment) protects against an exception that never comes, while the user waits forever.
>
> **Ve zkratce.** `img.onload`/`onerror` nemusí přijít NIKDY. Promise nad nimi bez časového stropu se
> pak nikdy nedokončí – volajícího `try/catch` chrání před výjimkou, ne před zaseknutím, a uživateli
> visí celá operace kvůli doplňku.

## Symptom

You convert an SVG to PNG in the browser — chart export, thumbnail generation, "save as image":

```js
export function svgToPngBlob(svg, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { /* draw to canvas, canvas.toBlob(resolve) */ };
    img.onerror = () => reject(new Error('Could not render the image.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
```

The caller embeds the result into a generated page and is deliberately forgiving:

```js
try {
  const blob = await svgToPngBlob(svg, w, h);
  await upload(blob);
} catch (e) {
  console.warn('chart embed failed:', e);   // best-effort: a chart must not break page creation
}
```

Then someone reports that creating the page never finishes. No error, no console output — a spinner
that spins until the tab is closed.

## Cause

Neither handler fires. Two ways to get there:

- **No canvas at all.** In a headless/test environment (jsdom) `Image` exists but nothing decodes,
  so neither callback runs. This is how it usually gets discovered: unit tests *time out* instead of
  failing, which reads like "slow tests" rather than "the code has no way to finish."
- **In a real browser**, a malformed SVG, a blocked `data:` URL (CSP), or a decode that never
  completes can leave the load in limbo.

The wider point: `try/catch` around `await` handles **rejection**. A Promise that never settles is
not a rejection — control never returns, so no handler runs. The comment promising "best-effort"
is then a claim the code cannot honour.

## Fix

Give every callback-backed Promise a deadline, and route **all** exits through one guard so a late
callback can't resolve after the timeout already rejected:

```js
export function svgToPngBlob(svg, width, height) {
  return new Promise((resolve, reject) => {
    const st = { done: false, timer: undefined };
    const finish = (fn) => {
      if (st.done) return;
      st.done = true;
      clearTimeout(st.timer);
      fn();
    };
    st.timer = setTimeout(
      () => finish(() => reject(new Error('Image conversion timed out.'))),
      15000
    );
    try {
      const img = new Image();
      img.onload = () => {
        try { /* … */ finish(() => resolve(blob)); }
        catch (e) { finish(() => reject(e)); }
      };
      img.onerror = () => finish(() => reject(new Error('Could not render the image.')));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch (e) { finish(() => reject(e)); }
  });
}
```

Holding `timer` in an object avoids the declaration cycle you get from `let timer` +
a `finish` that reads it (ESLint `no-use-before-define` vs. `prefer-const` will otherwise
contradict each other).

## Why it's easy to miss

- **A timing-out test looks like a slow test.** The instinct is to raise the timeout, which hides
  the defect permanently. Treat "it timed out" as "something never completes" until proven otherwise.
- The surrounding `try/catch` makes the call site *look* defensive, and code review reads the
  comment rather than asking what happens when the callback simply doesn't arrive.
- It only bites on the unhappy path, which is rare in a browser — so it can ship and sit for years.

## See also

- Same class: any Promise over `onload`, `onerror`, `onmessage`, `postMessage`, or a `<script>` tag
  injection. If nothing guarantees the callback, nothing guarantees the Promise settles.
- `gotchas/spfx/office-file-extraction-needs-a-decompressed-size-cap.md` — the other half of
  "client-side conversion needs a hard limit", there on size rather than time.
