---
title: "Audio in an SPFx web part (SharePoint and Teams): playback may be refused, the feature must not stop"
short-title: "Audio in SPFx/Teams must be optional"
summary: SPO's CSP has no media-src today, so MP3 from your CDN plays; start playback from a click and fall back to silent timing on NotAllowedError, 404 or mute
tags: [spfx, teams, audio, csp, autoplay, accessibility]
applies-to: SharePoint Online modern pages and SPFx apps hosted in Microsoft Teams (desktop, web)
last-reviewed: 2026-10-28
---

# Audio in SPFx and Teams: playback may be refused — the feature must not stop

> **Bottom line.** A narrated walkthrough, a notification sound or a voice-over in an SPFx app can fail for reasons you don't control: the browser's or webview's autoplay policy rejects `play()`, the file is missing, the user has muted it, or the tenant's Content Security Policy gets stricter one day. Design audio as optional: start it from a user click, and when `play()` rejects (or the file 404s) carry on with a silent timer based on the text length and show a small "no sound" indicator. Never block the flow or show an error because of audio.
>
> **Ve zkratce.** Zvuk v SPFx appce (průvodce s hlasem, upozornění) může selhat z důvodů mimo vaši kontrolu: autoplay politika prohlížeče nebo webview odmítne `play()`, soubor chybí, uživatel ztlumil, nebo tenant zpřísní CSP. Zvuk navrhněte jako nepovinný: spouštějte ho kliknutím a při odmítnutí `play()` (nebo 404) pokračujte tichým časováním podle délky textu s malým příznakem „bez zvuku“. Kvůli zvuku nikdy neblokujte ani nehlaste chybu.

## What was measured (28 Oct 2026)

- The `Content-Security-Policy` header of a SharePoint Online page contained only `script-src` and `worker-src` — **no `media-src` and no `default-src`**. An `<audio>` / `new Audio(url)` pointing to MP3 files on a separate CDN domain played without any tenant change.
- Playback started from a click (a ▶ button) worked in Chrome on SharePoint and inside the Teams client.

Microsoft can tighten the CSP at any time, and autoplay policies differ between browsers and webviews — which is why the fallback matters more than the measurement.

## Pattern

```ts
type Result = 'ended' | 'silent' | 'stopped';

function playStep(url: string | undefined, text: string, muted: boolean): Promise<Result> {
  const silentMs = Math.max(2500, text.length * 60);           // reading-speed fallback
  const silent = () => new Promise<Result>(r => setTimeout(() => r('silent'), silentMs));
  if (!url || muted) return silent();

  const audio = new Audio(url);
  return new Promise<Result>(resolve => {
    audio.onended = () => resolve('ended');
    audio.onerror = () => silent().then(resolve);               // 404, decode error, CSP block
    audio.play().catch(() => {                                   // NotAllowedError (autoplay), etc.
      markBlocked();                                             // show a "no sound" chip once
      silent().then(resolve);
    });
  });
}
```

- Call the first `play()` **inside the click handler** of the button that starts the narration; later steps in the same session are then usually allowed too.
- Remember the user's mute choice per browser (`localStorage`, wrapped in try/catch).
- Keep a stop/pause control that cancels both the audio and the silent timer, so a superseded step never advances the flow.
- Pre-generate audio files and host them as static assets; no speech service is called at runtime, so there is no key in the bundle and nothing to rate-limit.
