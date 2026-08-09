---
title: "Your Application Customizer's floating UI disappears when navigating the site"
tags: [spfx, application-customizer, extensions, spa, navigation, ui]
applies-to: SharePoint Online (SPFx Application Customizer / any extension rendering persistent floating UI)
last-reviewed: 2026-08-09
---

# Your Application Customizer's floating UI disappears when navigating the site

> **Bottom line.** Modern SharePoint pages are a SPA — moving between pages is **not** a full reload, so your Application Customizer's `onInit` does not run again, yet SharePoint tears your hand-appended node out of the DOM. Re-render on `this.context.application.navigatedEvent`, not on `visibilitychange` (which never fires on in-page navigation). Add a `MutationObserver` on `document.body` as a safety net for non-navigation removals.
>
> **Ve zkratce.** Moderní stránky SharePointu jsou SPA – přechod mezi stránkami NENÍ full reload, takže `onInit` Application Customizeru se znovu nespustí, ale SharePoint váš ručně vložený uzel z DOM sundá. Re-render napojte na `this.context.application.navigatedEvent`, ne na `visibilitychange` (ten se u in-page navigace nespustí). Jako pojistku na ne-navigační odstranění přidejte `MutationObserver` na `document.body`.

## Symptom

Your extension renders a persistent floating element — a chat bubble, help launcher, feedback tab — by creating a node and appending it to `document.body`. On first load it shows up correctly.

Then the user clicks around the site (a link, a list item, the left nav) and the button **vanishes**. It does not come back on a normal refresh (F5); only a hard refresh (Ctrl+Shift+R) brings it back. No console errors.

## Cause

Two things combine, and the second one sends you chasing the wrong fix.

**1. Navigation is client-side, so `onInit` runs once.** Modern SharePoint is a single-page app. Navigating between pages swaps page content in place; it does **not** reload the document. An Application Customizer's `onInit` fires on the first full load and then never again for the life of that document. During the in-place swap, SharePoint rebuilds large parts of the DOM and your body-appended node goes with it. Nothing re-adds it.

**2. `visibilitychange` looks like the fix but is not.** It is tempting to "re-validate on `visibilitychange`" — but that event fires only when the tab or window is hidden/shown (switching tabs, minimizing). It does **not** fire during in-page SPA navigation, because the tab stays visible the whole time. So a handler wired to `visibilitychange` never runs while the user is clicking around, which is exactly when the element disappears.

The F5-vs-hard-refresh detail is a **red herring** that points you at caching. After you deploy a new version, SharePoint may keep serving the previously cached component manifest/bundle until a hard refresh clears it — so a plain F5 can load stale code while Ctrl+Shift+R loads the new build. That difference is about *deploy caching*, not about a per-request config cache, and "add cache-busting to my config read" will not fix the disappearance.

## Fix

Re-render on the navigation event, and keep a `MutationObserver` as a backstop:

```ts
public async onInit(): Promise<void> {
  await super.onInit();
  await this._tryRender();

  // Canonical fix: SharePoint fires navigatedEvent on every client-side navigation.
  // onInit will NOT run again on SPA nav; this will.
  this.context.application.navigatedEvent.add(this, this._onNavigated);

  // Safety net for non-navigation removals (some SP versions also prune unknown
  // body nodes on the same page). Watch only direct body children → cheap.
  if (typeof MutationObserver !== 'undefined') {
    this._observer = new MutationObserver(() => {
      if (this._rendering) return;
      if (this._shouldSkip()) return;                         // cheap sync hide-checks
      if (document.getElementById(CONTAINER_ID)) return;      // still there → nothing to do
      void this._tryRender();
    });
    this._observer.observe(document.body, { childList: true });
  }
}

private _onNavigated = (): void => {
  if (this._shouldSkip()) return;
  void this._tryRender();
};

protected onDispose(): void {
  this.context.application.navigatedEvent.remove(this, this._onNavigated);
  if (this._observer) { this._observer.disconnect(); this._observer = undefined; }
  // …unmount + remove container…
  super.onDispose();
}
```

Notes:

- **`_tryRender` must be idempotent.** Guard on `getElementById(CONTAINER_ID)` and hold a synchronous `_rendering` lock across the whole async path (config reads, etc.) so `navigatedEvent` and the observer can both call it without double-mounting. See [Application Customizer runs again inside dialog iframes](application-customizer-runs-in-dialog-iframe.md) for the same-document race.
- **Keep the observer cheap.** Watch `document.body` with `{ childList: true }` only (not `subtree`) — it fires when layers/dialogs are added or removed, which is rare enough. Bail out immediately when the container is still present; only run the expensive path (config read + render) when it is actually gone.
- **Guard against thrash.** If the extension has a page-state reason to *not* render (e.g. a full-page web part version of the same feature is present), re-check that cheaply (`_shouldSkip`) inside the observer, or you will re-add what your own hide logic just removed, and fight yourself on every mutation.
- **This is not caught by the compiler, linter, or build.** It only shows up when you click through a live site. Verify by navigating, not by unit tests.

## Refinement: the observer misses deep-DOM removals

`MutationObserver(document.body, { childList: true })` only fires on **direct** body children. If your re-render depends on some *other* element disappearing deep in the page — e.g. you hide the floating button while a full-app web part is present and wait for that web part's marker to be removed on navigation — the observer never wakes, because the marker lives deep in the canvas, not as a body child. The button then stays gone until an unrelated body-child mutation happens to fire.

Fix: after navigation, run a short **bounded poll** (e.g. every 500 ms for ~5 s) that re-checks the condition and renders once the deep node is gone. A poll beats `subtree: true` here, which would fire the callback — and any `querySelector` inside it — on *every* DOM mutation anywhere (expensive on busy pages). Async component loading (a bundle fetched from a CDN) slows teardown and widens this race, so the symptom can appear only after such a change.

## How to verify

1. Open a page of the site where the extension is deployed. The floating element shows.
2. Click to another page **within the site** (left nav, a list, a document library) without a full reload. The element should stay (or reappear within a frame).
3. In DevTools, add a breakpoint or log in the `navigatedEvent` handler and confirm it fires on each in-page navigation — and that `visibilitychange` does **not** fire for the same clicks.
