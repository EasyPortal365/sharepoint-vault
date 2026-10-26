---
title: "pdf.js: \"Cannot use the same canvas during multiple render() operations\" on resize"
short-title: pdf.js refuses two renders into one canvas
summary: A React effect that re-renders a PDF page on every resize starts a second render() before the first finishes; cancel the running task in cleanup and chain renders so they never overlap
tags: [spfx, pdfjs, canvas, react, resize-observer]
applies-to: pdf.js 3.11 in the browser (measured; later versions keep the same render task API) – SPFx web parts or any React app showing a PDF preview
last-reviewed: 2026-10-26
---

# pdf.js refuses two renders into one canvas

> **Bottom line.** A PDF preview that re-renders on resize or zoom breaks with *"Cannot use the same canvas during multiple render() operations"* as soon as the size changes several times in a row (maximizing the web part, dragging a splitter). A `cancelled` flag in the effect cleanup does not help — it only stops the state update, not the render that is still drawing. Keep the render task, `cancel()` it in cleanup, chain renders so the next starts only after the previous settled, and treat `RenderingCancelledException` as normal.
>
> **Ve zkratce.** Náhled PDF, který se překresluje při změně velikosti nebo zoomu, spadne na *„Cannot use the same canvas during multiple render() operations“*, jakmile se velikost změní několikrát za sebou (maximalizace webpartu, tažení děliče). Příznak `zruseno` v úklidu efektu nepomůže – zastaví jen zápis stavu, ne běžící kreslení. Úlohu vykreslení si drž, v úklidu ji `cancel()`, vykreslení řetěz, ať další začne až po doběhnutí předchozího, a `RenderingCancelledException` ber jako normální stav.

## Symptom

The preview works on first load. After maximizing the host (SharePoint full-width, Teams tab resize) the canvas area shows an error instead of the page:

```
Cannot use the same canvas during multiple render() operations. Use different canvas or ensure previous operations were cancelled or completed.
```

## Cause

The effect depends on the measured container size (`ResizeObserver`) and zoom. Each change runs `page.render({ canvasContext, viewport })` into the **same** canvas while the previous render is still in progress. pdf.js tracks the canvas and throws for the second one. The usual "ignore stale result" pattern (`let cancelled = false; return () => { cancelled = true; }`) does not stop the running render.

## Fix

```ts
const taskRef = useRef<{ promise: Promise<void>; cancel(): void } | null>(null);
const chainRef = useRef<Promise<void>>(Promise.resolve());

useEffect(() => {
  let cancelled = false;
  const run = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const page = await pdf.getPage(pageNo);
      const vp = page.getViewport({ scale });
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const task = page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp });
      taskRef.current = task;
      await task.promise;
    } catch (e) {
      if (!cancelled && (e as { name?: string }).name !== 'RenderingCancelledException') setError(e);
    }
  };
  // Serialize: the next render starts only after the previous one finished or was cancelled.
  chainRef.current = chainRef.current.then(run, run);
  return () => { cancelled = true; taskRef.current?.cancel(); };
}, [pdf, pageNo, scale]);
```

- `cancel()` makes the running task's promise reject with `RenderingCancelledException` — that is expected, not an error to show.
- The chain matters: `cancel()` is asynchronous, so starting the new render immediately can still hit the old one.

## Related

- [pdf-parse and pdfjs-dist cannot share a process](../azure-functions/pdf-parse-and-pdfjs-dist-cannot-share-a-process.md) — the server-side pdf.js trap.
