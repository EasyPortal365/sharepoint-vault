---
title: "Diagnostics that cannot survive the crash they are diagnosing"
tags: [tooling, debugging, telemetry, localstorage, sessionstorage, crash, spfx, browser]
applies-to: Any in-page diagnostic used to investigate a freeze, hang, or out-of-memory crash
last-reviewed: 2026-08-26
---

# Diagnostics that cannot survive the crash they are diagnosing

> **Bottom line.** An in-page diagnostic that reports through the UI, is gated on a flag in `sessionStorage`, or writes its findings to a single last-write-wins slot will produce **nothing at all** in the one situation it was built for. A frozen main thread stops repainting and stops timers; a closed tab wipes `sessionStorage`; and the healthy run that follows the crash overwrites the crash data before anyone reads it. Persist synchronously, key the recovery on the data rather than on a flag, and never let a later run clobber an earlier crash report.
>
> **Ve zkratce.** Diagnostika, která hlásí přes UI, je podmíněná příznakem v `sessionStorage` nebo zapisuje do jediného slotu „poslední zápis vyhrává", nedodá **vůbec nic** právě v situaci, kvůli které vznikla. Zablokované hlavní vlákno přestane překreslovat i pouštět časovače, zavřená karta smaže `sessionStorage` a zdravý běh po pádu přepíše data z pádu dřív, než je někdo přečte. Zapisujte synchronně, záchranu podmiňte DATY, ne příznakem, a nedovolte pozdějšímu běhu přemazat starší hlášení o pádu.

## Symptom

You add an on-page diagnostic panel to investigate "the browser freezes on this page". Users reproduce the freeze repeatedly. You receive nothing usable:

- The panel is **stuck showing the state from the moment it started** — 0 seconds elapsed, zero counters.
- After the tab dies with an out-of-memory error, there is no data at all.
- When the user reloads and the diagnostic does recover something, it turns out to describe the **healthy run after the crash**, not the crash.

Each of these has a different cause, and all three are design mistakes in the diagnostic — not in the code under investigation.

## Cause

**1. A frozen thread cannot report.** While the main thread is blocked, nothing repaints and no timer callback runs. An overlay refreshed by `setInterval` silently keeps the text from its last successful tick — which looks like "the app stopped at second 0", an actively misleading reading. `requestAnimationFrame`-based refresh is worse: it does not run at all.

**2. `sessionStorage` does not survive the crash.** Enabling a debug mode and storing the flag in `sessionStorage` feels right — it should not leak into other sessions. But the tab being diagnosed is exactly the tab that gets closed, killed, or "Exit page"-d. On the next load, the flag is gone, so the code decides diagnostics are off and never even looks at the breadcrumbs it saved. The data is on disk and unreadable by its own reader.

**3. One slot, last write wins.** Crash data recovered on the next load gets written to the same field as the ongoing run's report. A few seconds later the healthy run overwrites it. You end up holding a perfectly detailed record of a run in which nothing went wrong.

**4. Counters that are never persisted.** Saving a breadcrumb trail but not the counters and memory samples leaves you with "the last step was X" — and no way to tell what happened between X and the freeze, which is the entire question.

## Fix

**Persist synchronously, on every step, to storage that outlives the tab.**

```js
// localStorage survives a tab crash and a browser restart; write on every breadcrumb.
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      at: new Date().toISOString(),
      marks,        // breadcrumbs: { ms, heapMB, step }
      counters,     // how many renders / observer wakeups / scroll events
      rates,        // peak per second — this is what separates "busy" from "looping"
      heap          // last N memory samples, so the run-up is visible
    }));
  } catch { /* full or blocked storage must not break the app */ }
}
```

**Rules that follow from the failures above:**

1. **Record a step BEFORE the expensive operation, never after.** The last breadcrumb then names the place execution stopped.
2. **Keep the enable flag where the crash cannot reach it** (`localStorage`, not `sessionStorage`), and read the URL parameter as an override.
3. **Never gate crash recovery on the current flag.** If unfinished data exists, ship it — it was collected while diagnostics were on, and whether they are on *now* is irrelevant. Clear it after a successful send so the same crash is not reported forever.
4. **Append; do not overwrite.** Prefix the recovered crash report to every subsequent report, or write it to a separate slot. A later healthy run must not be able to erase it.
5. **Persist counters and a memory series, not just breadcrumbs.** "Renders per second" and "where the heap jumped" answer the question; "the last step was X" only locates it.
6. **Print zero-valued counters explicitly.** A counter that is absent because it is zero cannot be distinguished from a counter that was never wired up.
7. **Include the build version in the report.** Investigations that span several releases are otherwise impossible to interpret, and you will change something mid-investigation.
8. **Include a validity signal.** A "scroll events" counter proves the tester actually exercised the page; without it, "0 observer wakeups" means both "all quiet" and "nobody tried anything".

## Getting the data out

Even a correctly persisted report is useless if a person has to copy it out of a browser that just died. Two options that work, in order of preference:

- **Write it where you can read it yourself.** For a SharePoint-hosted app: a multiline text column on a per-user settings row. The user does nothing; you query it. Have the write patch an existing row and **skip when the row is missing** — a diagnostic that creates rows will duplicate the user's real settings the first time the original is missing or in the recycle bin.
- **Send it periodically while the page is alive.** A request issued a moment before the freeze is completed by the browser even if the JS thread then blocks, so a short interval (~10 s) captures state close to the failure without relying on the user reloading.

Email is a poor fit here even where an API exists: it usually sends from the affected user's own mailbox, needs a permission your app may not have, and — being interval-driven — stops firing exactly when the thread blocks.
