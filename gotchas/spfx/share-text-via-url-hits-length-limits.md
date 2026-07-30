---
title: "Sharing text through a URL (Teams /share, mailto) breaks at length limits"
tags: [spfx, teams, deeplink, mailto, sharing, aad, ui]
applies-to: SharePoint Online / SPFx / any web app with "share to Teams" or "share via e-mail" buttons
last-reviewed: 2026-07-30
---

# Sharing text through a URL (Teams /share, mailto) breaks at length limits

> **Bottom line.** A "Send to Teams" (`teams.microsoft.com/share?msgText=…`) or "Share via e-mail" (`mailto:?body=…`) button that puts the whole content in the URL works for short text and fails for long: Teams redirects to sign-in and dies with `AADSTS90015: Requested query string is too long`, and `mailto` just never opens the mail client. Cap the URL payload hard, put the full text on the clipboard, and for mailto use `window.location.href`, not `window.open('_self')`.
>
> **Ve zkratce.** Tlačítko „Poslat do Teams" (`teams.microsoft.com/share?msgText=…`) nebo „Sdílet e-mailem" (`mailto:?body=…`), které cpe celý obsah do URL, funguje na krátkém textu a na dlouhém padá: Teams přesměruje na přihlášení a skončí `AADSTS90015: Requested query string is too long`, `mailto` mailového klienta prostě neotevře. Payload v URL tvrdě omez, plný text dej do schránky a pro mailto použij `window.location.href`, ne `window.open('_self')`.

## Symptom

Below each answer/record you have share buttons. They work in testing (short content).

Then someone shares a **long** answer:

- **Send to Teams** lands on the Microsoft sign-in page with `AADSTS90015: Requested query string is too long`. (Request Id / Correlation Id in the error — a dead giveaway it's the AAD sign-in endpoint, not Teams.)
- **Share via e-mail** does *nothing at all* — no draft, no error, no console message.

## Cause

Both buttons serialize the entire content into a URL, and each URL has a limit you blow past.

**Teams `/share` → AAD query-string limit.** The share launcher `https://teams.microsoft.com/share?msgText=<text>&href=<url>` is fine once you're signed into Teams web. If you are **not** signed in, the launcher redirects to `login.microsoftonline.com`, carrying the *entire* share URL — including your `msgText` — as a parameter of the sign-in request. AAD caps the query-string length and rejects it with `AADSTS90015`. Two things make this worse than it looks:

- `encodeURIComponent` inflates non-ASCII text and newlines ~3× (`á` → `%C3%A1`, `\n` → `%0A`).
- AAD then wraps the already-encoded share URL and encodes it **again** (double-encoding).

So a "safe-looking" 1,800-character cap on `msgText` still overflows. And because it depends on Teams-web sign-in state, it passes on the dev's machine and fails on the user's.

**`mailto` → URL length limit + swallowed `window.open`.** `mailto:?subject=…&body=<text>` has a practical URL length limit (~2,000 chars; varies by mail client and OS). A long `body` silently fails to launch the client — no error. On top of that, `window.open('mailto:…', '_self')` is sometimes swallowed in an SPFx page; the canonical trigger is assigning `window.location.href`.

## Fix

Cap the URL payload hard, and put the full text on the clipboard as the real carrier:

```ts
// Teams — msgText must survive a *double*-encoded AAD redirect, so keep it tiny.
const TEAMS_CAP = 350;
let text = full;
if (full.length > TEAMS_CAP) {
  text = full.substring(0, TEAMS_CAP) + '…\n\n(Full text copied to your clipboard — paste it with Ctrl+V.)';
  void navigator.clipboard?.writeText(full);   // full content preserved
}
const url = 'https://teams.microsoft.com/share?msgText=' + encodeURIComponent(text)
  + (href ? '&href=' + encodeURIComponent(href) : '');
window.open(url, '_blank', 'noopener,noreferrer');   // sync in the click = no popup block

// mailto — single encode, but still a URL-length limit; and use location.href.
const MAIL_CAP = 700;
let body = full;
if (full.length > MAIL_CAP) {
  body = full.substring(0, MAIL_CAP) + '…\n\n(Full text copied to your clipboard — paste it with Ctrl+V.)';
  void navigator.clipboard?.writeText(full);
}
window.location.href = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
```

Notes:

- **The clipboard is the payload, the URL is the launcher.** For long content, the URL only carries a preview + a note; the full text rides the clipboard. `mailto` via `location.href` does not navigate the page away, so the async clipboard write still completes; `window.open('_blank')` opens a new tab and leaves your page alive too.
- **Pick the caps for the *encoded* worst case.** ~350 for Teams (double-encoded, non-ASCII heavy), ~700 for mailto (single-encoded). If your content is ASCII-only you can go higher, but conservative caps never fail.
- **The real fix for unlimited send is a different channel** — Graph `chatMessage` (post to a chat/channel) or `sendMail` — but those need a delegated scope and admin consent, so they are a feature, not a hotfix.
- **Nothing catches this at build time.** The compiler, linter, and unit tests all pass; the limit is a runtime property of the URL and, for Teams, of the user's sign-in state. Test with a genuinely long payload.

## How to verify

1. Share a **short** answer to Teams and via e-mail — both open with the text pre-filled.
2. Share a **long** answer (a few thousand characters). Teams opens (preview + "on clipboard" note) instead of `AADSTS90015`; the mail client opens instead of doing nothing. Paste (Ctrl+V) to confirm the full text is on the clipboard.
3. For the Teams case specifically, test while **signed out** of Teams web in that browser profile — that is the path that triggers the AAD redirect.
