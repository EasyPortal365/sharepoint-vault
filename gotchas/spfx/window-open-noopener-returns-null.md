---
title: window.open with noopener returns null even when the tab opened — so your fallback runs every time
tags: [spfx, browser, window-open, popups, email, print]
applies-to: Any browser code, SPFx web parts and extensions included (Outlook on the web links, print windows, "open in new tab")
last-reviewed: 2026-09-24
---

# `window.open(…, 'noopener')` returns `null` even when the tab opened — so your fallback runs every time

> **Bottom line.** With `noopener` (or `noreferrer`) in the features string, `window.open` returns `null` by specification — also when the window did open. Code that reads `null` as "the popup was blocked" runs its fallback every single time: the e-mail opens twice, the print window stays empty. When you need to know whether the window opened, drop the feature and cut the link yourself: `const w = window.open(url, '_blank'); if (w) w.opener = null;`.
>
> **Ve zkratce.** S `noopener` (nebo `noreferrer`) ve features vrací `window.open` podle specifikace `null` – i když okno otevřel. Kód, který `null` čte jako „popup zablokovaný“, spustí náhradní cestu pokaždé: e-mail se otevře dvakrát a tiskové okno zůstane prázdné. Když potřebuješ vědět, jestli se okno otevřelo, feature vynech a vazbu přeruš sám: `const w = window.open(url, '_blank'); if (w) w.opener = null;`.

## Symptom

Two features in a shared document-actions package, both "working" in a quick test:

- **"Send by e-mail"** opened an Outlook on the web compose window — and immediately afterwards the local mail client via `mailto:`. Every user got the message twice.
- **"Print"** for a comparison and a permissions report opened a new window and left it blank.

## Cause

The HTML specification's window open steps end with *"If noopener is true or noreferrer is true, then return null."* The window opens; the caller just never gets a handle to it. So:

```ts
let win: Window | null = null;
try { win = window.open(owaComposeUrl, '_blank', 'noopener'); } catch { /* blocked */ }
if (!win) openMailto(item);            // null every time → mailto opens as well

const w = window.open('', '_blank', 'noopener,width=760,height=900');
if (!w) return;                        // returns every time → nothing is written into the window
w.document.write(html);
```

`noopener` is usually added for a good reason (the opened page must not reach back through `window.opener`), which is why it survives review.

## Fix

Open without the feature and cut the back-reference yourself:

```ts
export function openInNewTab(url: string): boolean {
  const w = window.open(url, '_blank');
  if (!w) return false;          // really blocked
  w.opener = null;               // same protection noopener gave you
  return true;
}

if (!openInNewTab(owaComposeUrl)) openMailto(item);
```

For a print window, open `about:blank` the same way, keep the handle, write the document, then call `print()`. If you genuinely don't need the handle, `noopener` is fine — just don't put an `if (!w)` after it.

## Notes

- A blocked window must still be admitted to the user ("Your browser blocked the new window"), not swallowed. In the Teams webview `window.open` can be blocked even when called synchronously from a click.
- Put the helper in one place. The trap went away in the apps that had it and survived in a shared package — a lint rule or guard that scans only the app's own `src/` never looks inside `node_modules`, so a package needs its own scan.
- Related: [A `mailto:` fallback reported as sent](../graph/sendmail-fallback-reported-as-sent.md) — the reporting side of fallbacks.
