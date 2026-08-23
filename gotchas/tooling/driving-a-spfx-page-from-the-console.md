---
title: Driving an SPFx page from the console — two traps that fake success
tags: [tooling, spfx, automation]
applies-to: SharePoint Online
last-reviewed: 2026-08-19
---

# Driving an SPFx page from the console — two traps that fake success

> **Bottom line.** Setting `input.value` from the console does **not** update a React component's state, so the form saves nothing while looking like it worked. And a `window.confirm()` behind a destructive button **blocks the renderer**, so any CDP-based automation (Playwright, Puppeteer, an assistant's browser tooling) hangs on it. Both fail as *success*, which is what makes them expensive.
>
> **Ve zkratce.** Nastavení `input.value` z konzole **neaktualizuje** stav React komponenty – formulář „uloží" prázdno a tváří se, že je hotovo. A `window.confirm()` za destruktivním tlačítkem **zablokuje renderer**, takže se na něm každá CDP automatizace zasekne. Obojí selže jako úspěch, a to je na tom to drahé.

## Trap 1 — `input.value = x` leaves React state empty

SPFx web parts are React. A controlled input's value lives in component state, updated from the `onChange`/`input` event. Assigning `.value` directly changes the DOM node and nothing else:

```js
document.querySelector('input').value = '1.2.3';   // component state: still ''
saveButton.click();                                 // saves '' — no error, no validation
```

The click "succeeds", no exception is thrown, and if the handler has no empty-check you get a silent write of the wrong (or empty) value.

**Fix — go through the native setter and dispatch the event React listens for:**

```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, '1.2.3');
input.dispatchEvent(new Event('input', { bubbles: true }));
```

React installs its own `value` setter on the element instance; calling the prototype setter bypasses it so React's change-tracking sees a real difference. For `<textarea>` use `HTMLTextAreaElement.prototype`, for `<select>` dispatch `change`.

**And verify at the destination, not on screen.** "The click happened" is not evidence of a write. Read the value back from wherever it lands — the list item, the config row, the API — because a UI that renders its own state will happily show you what it *thinks* is true.

## Trap 2 — `window.confirm` freezes CDP automation

A native modal (`confirm`, `alert`, `prompt`) parks the renderer's main thread until it is dismissed. Over the DevTools Protocol that looks like a dead page:

- `Input.dispatchMouseEvent` → timeout
- `Page.captureScreenshot` → timeout
- keystrokes sent to the *page* never reach the dialog

Nothing in the error says "a dialog is open", so it reads as a crashed tab.

**Fix — pick one:**

1. **Auto-answer it** before triggering the action, and restore it afterwards:
   ```js
   const orig = window.confirm; window.confirm = () => true;
   // …trigger the action…
   window.confirm = orig;
   ```
   Only do this when you are deliberately performing that one action — a blanket "yes" on a live tenant is a footgun.
2. **Handle the dialog properly** if your driver supports it (Playwright `page.on('dialog', d => d.accept())`, CDP `Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog`).
3. **Skip the click** and verify the outcome another way (REST `?$select=ItemCount`), then say plainly that the click was not performed. Reporting "verified" when you only verified that a button renders is worse than reporting nothing.

## Related

- [Getting bulk data into a SharePoint page from the console](getting-bulk-data-into-a-sharepoint-page-from-the-console.md)
