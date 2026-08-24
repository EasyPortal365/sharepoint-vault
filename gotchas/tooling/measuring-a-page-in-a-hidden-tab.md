---
title: "Performance measurements taken in a hidden browser tab are worthless — and they look like a freeze"
tags: [tooling, debugging, performance, devtools, requestanimationframe, timers, automation]
applies-to: Any browser automation or console-driven measurement (Chrome/Edge; SPFx pages included)
last-reviewed: 2026-08-24
---

# Performance measurements taken in a hidden browser tab are worthless — and they look like a freeze

> **Bottom line.** A background tab does not run `requestAnimationFrame` **at all** and throttles `setTimeout` to roughly once per second. A measurement script built on either will hang, time out, and read exactly like the renderer freeze you were trying to reproduce — while the code under test never ran either. Check `document.visibilityState` before you believe a single number.
>
> **Ve zkratce.** Karta na pozadí nepouští `requestAnimationFrame` **vůbec** a `setTimeout` zpomaluje zhruba na jednou za sekundu. Měřicí skript postavený na kterémkoli z nich se zasekne, vyprší a vypadá přesně jako to zamrznutí rendereru, které jste chtěli reprodukovat – přitom testovaný kód taky neběžel. Než jakémukoli číslu uvěříte, přečtěte `document.visibilityState`.

## Symptom

You are chasing a report of "the browser freezes on this page". You drive the page from the console (or from an automation tool that evaluates JavaScript in the tab) with something like:

```js
for (let i = 0; i < 40; i++) { scroller.scrollTop += 200; await new Promise(r => requestAnimationFrame(r)); }
```

The call never returns. The tool reports a renderer timeout. It certainly *looks* like you reproduced the freeze — the page stopped responding to your script, which is what "frozen" means.

Switching to timers does not help:

```js
for (let i = 0; i < 25; i++) { scroller.scrollTop += 200; await new Promise(r => setTimeout(r, 16)); }
```

That, too, times out.

## Cause

The tab was in the background. Browsers aggressively suspend hidden tabs:

- **`requestAnimationFrame` callbacks do not fire at all** while a tab is hidden. There are no frames to paint, so awaiting one waits forever.
- **`setTimeout` / `setInterval` are clamped** to roughly one second in background tabs (and can be frozen entirely after several minutes of inactivity). Your `25 × 16 ms` loop is not 0.4 s; it is 25 s or worse — long enough to blow past a typical automation timeout.

Both failure modes surface as "the renderer may be frozen or unresponsive", which is the same message you would get from a genuine runaway loop.

There is a second, quieter half to this, and it is the one that actually invalidates the experiment: **the code you are testing is throttled too.** Any layer that schedules its work through `requestAnimationFrame` — most redraw and layout-sync code does — simply does not execute while the tab is hidden. So a hidden-tab run can report a beautifully flat memory graph and zero observer wake-ups, and prove nothing whatsoever.

## Fix

**Check visibility first, and treat a hidden tab as "no result", not as a result.**

```js
document.visibilityState   // 'visible' | 'hidden'
document.hidden            // true = anything you measure next is suspect
```

Then:

- **Run interactive/timing measurements only in a foreground tab.** If your automation cannot guarantee focus, say so in the write-up rather than reporting the numbers.
- **In a hidden tab, measure synchronously.** One block, no `await`. Reading layout (`getComputedStyle`, `offsetHeight`) forces a synchronous reflow, so you can still measure the *cost* of a DOM operation; you just cannot measure anything that depends on frames or timers elapsing.
- **Treat zeros with suspicion.** In a hidden tab, "0 redraws, 0 observer wake-ups, flat heap" is more likely to mean *suspended* than *healthy*. A negative result from a suspended tab is not evidence of absence.
- **Prefer in-page instrumentation over remote driving** for anything that must run over time: have the page count events into a global itself, then read that global later in a single synchronous call. The counters keep working across your own tool's round-trips, and the numbers come from whatever the tab actually did.

## Why this is worth a page of its own

The failure is self-confirming in the worst way: you are looking for a freeze, and the environment hands you something indistinguishable from a freeze. Without the visibility check there is nothing in the output to tell you the measurement was void, so the natural next step is to report a reproduction that never happened.
