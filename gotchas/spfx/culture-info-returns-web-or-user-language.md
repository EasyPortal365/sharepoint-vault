---
title: pageContext.cultureInfo returns the web language sometimes and the user language other times
short-title: cultureInfo returns the web or the user language
summary: The same page loads English once and Czech the next time; cache the resolved language per web instead
tags: [spfx, i18n, localization, pagecontext]
applies-to: SPFx web parts and extensions (SPFx 1.x), any tenant where the site language differs from the user's M365 language
last-reviewed: 2026-09-17
---

# `pageContext.cultureInfo` returns the web language sometimes and the user language other times

> **Bottom line.** Never make `cultureInfo.currentUICultureName` the sole input to "automatic language". The same page can load English once and Czech the next time with nothing changed. Remember the last *resolved* language in `localStorage`, keyed by web URL, and start from it — the network answer then confirms or corrects it.
>
> **Ve zkratce.** Nestavěj volbu „jazyk automaticky“ jen na `cultureInfo.currentUICultureName`. Tatáž stránka se načte jednou anglicky a podruhé česky, aniž se cokoli změní. Poslední VYŘEŠENÝ jazyk si zapamatuj v `localStorage` pod klíčem s URL webu a startuj z něj.

## Symptom

An app resolves its UI language through a cascade: an org-wide setting, then a hub-level setting, and if both are empty, `context.pageContext.cultureInfo.currentUICultureName`.

Both settings are empty. The first load renders the entire UI in English. A second load of the same page, same user, same browser, no data changed — renders it in Czech. Nothing in the app explains the difference, and neither language is "wrong": the site was created in Czech, and the signed-in user's Microsoft 365 UI language is English.

## Cause

`cultureInfo` carries **two different notions of language** and which one you get is not stable:

- the **web's** language (what the site was provisioned in), and
- the **user's** own Microsoft 365 UI language.

They differ in any tenant where someone has set a personal display language, which is common with international staff. `document.documentElement.lang` on a modern page shows the user's language, so comparing the two is a quick way to see whether you're exposed. When the last branch of a language cascade hangs on this value, "automatic" becomes non-deterministic.

## Fix

Persist the resolved language and use it as the starting point. This also removes the flash of the wrong language that a naive `useState('cs')` produces while the settings reads are still in flight.

```ts
const KEY = 'myapp_uilang_';

export function readUiLang(webUrl: string): 'cs' | 'en' | null {
  try {
    const v = window.localStorage.getItem(KEY + (webUrl || ''));
    return v === 'cs' || v === 'en' ? v : null;
  } catch {
    // Private window / site data blocked — the app must work without memory.
    return null;
  }
}

export function writeUiLang(webUrl: string, lang: 'cs' | 'en'): void {
  try { window.localStorage.setItem(KEY + (webUrl || ''), lang); }
  catch { /* convenience only, never a source of truth */ }
}
```

```tsx
// Start from the last known language, then confirm or correct it from the real source.
const [uiLang, setUiLang] = useState(() => readUiLang(webUrl) || 'cs');

useEffect(() => {
  let cancelled = false;
  Promise.all([appSettings.get(), hubConfig.get()]).then(([app, hub]) => {
    if (cancelled) return;
    const resolved = resolve(app.uiLanguage, hub.uiLanguage,
      context.pageContext.cultureInfo.currentUICultureName);
    setUiLang(resolved);
    writeUiLang(webUrl, resolved);
  }).catch(() => { /* keep the last known language */ });
  return () => { cancelled = true; };
}, [appSettings, hubConfig, webUrl, context]);
```

Key the storage by web URL — one browser routinely visits several sites with different settings.

## Related

Changing the language must take effect **immediately**, not after a refresh. It is the one setting that alters the UI under the hands of the person who just switched it, so a save that appears to do nothing reads as a failed save. Expose a `refreshUiLang()` from your app context and call it after a successful save; it only has to re-run the effect above.

The same "render something before two network reads return" problem applies to themes. If you already cache theme tokens in `localStorage` to avoid a flash of the wrong colours, this is the identical pattern for language — and worth doing for the same reason.
