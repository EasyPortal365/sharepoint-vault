---
title: "Your Application Customizer runs again inside SharePoint dialog iframes"
tags: [spfx, application-customizer, extensions, dialogs, iframe, ui]
applies-to: SharePoint Online (SPFx Application Customizer / any extension rendering floating UI)
last-reviewed: 2026-07-27
---

# Your Application Customizer runs again inside SharePoint dialog iframes

> **Bottom line.** SharePoint hosts some of its dialogs as a page of *the same site* inside an iframe (`IsDlg=1`). Your Application Customizer is registered on that site, so it loads a **second time** in the iframe and paints your floating button again — pinned to the dialog's corner instead of the window's. Refuse to render when `window.self !== window.top` (or `IsDlg=1` is in the query string) before you do anything else.
>
> **Ve zkratce.** SharePoint hostí část svých dialogů jako stránku *téhož webu* v iframu (`IsDlg=1`). Application Customizer je na webu registrovaný, takže se v iframu načte **podruhé** a vykreslí plovoucí tlačítko znovu – přilepené do rohu dialogu, ne okna. Hned na začátku odmítni vykreslení, když `window.self !== window.top` (nebo je v query stringu `IsDlg=1`).

## Symptom

Your extension renders a floating action button (chat bubble, help launcher, feedback tab) in the bottom-right corner of every page. It works.

Then a user opens a SharePoint dialog — *Site contents → New → Document library* is the usual one — and there are suddenly **two** buttons: the real one in the window corner, and a duplicate **inside the dialog**, sitting on top of its Cancel button.

Everything else looks normal. No console errors. A hard refresh brings back a single button until the dialog is opened again.

## Cause

Two things combine.

**1. The dialog is an iframe of your own site.** Not every SharePoint dialog is an in-page React layer; several still load a `_layouts` page with `IsDlg=1` inside an iframe. That page belongs to the same site, so every extension deployed to the site — yours included — boots inside it as a *separate document with its own DOM*.

**2. `position: fixed` resolves against the iframe's viewport.** That is why the duplicate is not stacked on the original: it is offset by your exact `right`/`bottom` values from the **dialog's** edges, because the dialog *is* the viewport of that document.

That geometry is also the fastest way to diagnose this from a screenshot alone. A `position: fixed` element attached to `document.body` cannot be positioned relative to some other element on the page — unless it lives in a nested browsing context. (A CSS `transform`/`filter`/`backdrop-filter` on an ancestor produces the same offset effect, but only for elements *inside* that ancestor — see [Fixed dropdowns in transformed panels](fixed-dropdowns-in-transformed-panels.md). For a body-level node, an iframe is the only explanation.)

The usual guard does not help:

```ts
// Only protects against a double mount in the SAME document.
if (document.getElementById(CONTAINER_ID)) return;
```

Each document has its own DOM, so the iframe copy sees no container and renders happily.

## Fix

Refuse nested browsing contexts first — before the config reads, the host checks, everything:

```ts
private async _render(): Promise<void> {
  // 1) Never render in an iframe. SharePoint hosts some dialogs as a page of the
  //    same site inside an iframe, where our extension loads a second time.
  try {
    if (window.self !== window.top) return;
  } catch {
    return; // cross-origin top — still nested, still refuse
  }
  // 2) Belt and braces: the dialog-mode query flag.
  if ((window.location.search || '').toLowerCase().indexOf('isdlg=1') !== -1) return;

  // …host checks, configuration read, render…
}
```

Notes:

- **Keep the `catch`.** Reading `window.top` across origins throws; a thrown check must mean "refuse", not "continue".
- **Both checks earn their place.** The iframe test catches every nesting (dialogs, page embeds, previews); `IsDlg=1` also covers a dialog page opened in its own tab, where the chrome is stripped but your floating UI would still be out of place.
- **This is not only about dialogs.** Anything that embeds a page of your site into another page produces the same duplicate.

## Related: a guard placed before an `await` is not a guard

The same feature usually carries a second, quieter version of the bug:

```ts
if (document.getElementById(CONTAINER_ID)) return;   // sync check
const cfg = await readConfiguration();               // ← the gap
document.body.appendChild(container);                // claim happens here
```

Two concurrent calls (a slow first read racing a re-validation on `visibilitychange`, say) both pass the check and both mount — this time *perfectly overlapping*, so nobody notices except that clicks hit the top copy and one React tree leaks. `onDispose` cleans up by `id` and removes only one.

Hold a synchronous lock across the whole async path, and release it in `finally` so a run that decided *not* to render still allows a later retry:

```ts
private _rendering = false;

private async _tryRender(): Promise<void> {
  if (this._rendering) return;
  if (document.getElementById(CONTAINER_ID)) return;
  this._rendering = true;
  try { await this._renderOnce(); } finally { this._rendering = false; }
}
```

## How to verify

1. Open a page of the site where the extension is deployed. One floating button.
2. Go to **Site contents → New → Document library** (any dialog that shows its own scrollbar is a good candidate). Still one button.
3. In DevTools, check the frame dropdown in the console: switch to the dialog's frame and run `document.querySelectorAll('[id="<your-container-id>"]').length` — expect `0` there and `1` in `top`.
