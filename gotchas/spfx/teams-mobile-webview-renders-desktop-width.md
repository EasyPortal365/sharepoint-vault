---
title: Teams mobile webview renders your tab at ~980px — and you can't reproduce it in a browser
tags: [spfx, teams, mobile, viewport]
applies-to: SharePoint Online (SPFx in Teams mobile)
last-reviewed: 2026-07-16
---

# Teams mobile webview renders your tab at ~980 px — and you can't reproduce it in a browser

> **Bottom line.** The Teams mobile webview lays your tab out at a legacy ~980 px because it never applies the `width=device-width` viewport, so set the viewport meta yourself in `onInit` — but gate it strictly on running inside Teams.
>
> **Ve zkratce.** Mobilní webview Teams vykreslí tvůj tab na legacy šířce ~980 px, protože nikdy neaplikuje viewport `width=device-width` – nastav si meta viewport sám v `onInit`, ale striktně jen když appka běží uvnitř Teams.

## Symptom

On phones, your Teams tab looks like a desktop page shrunk to fit: content overflows to the right, paddings look ignored, your responsive breakpoints never kick in. In a desktop browser — even resized to phone width, even in DevTools device emulation — everything is fine.

## Cause

The Teams **mobile webview lays the page out at a legacy default width (~980 px)** — the effective `width=device-width` viewport isn't applied to the embedded SPFx page. Desktop browsers always apply device-width, which is exactly why the bug is invisible everywhere except a physical phone.

Follow-on effect: any JS-based responsive logic that measures the root element's `clientWidth` sees ~980 px and happily reports "desktop".

## Fix

In `onInit`, when (and only when) running inside Teams, fix the viewport meta yourself:

```ts
const inTeams = !!this.context.sdks.microsoftTeams;
if (inTeams && typeof document !== 'undefined') {
  const head = document.head;
  let vp = head.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
  if (!vp) { vp = document.createElement('meta'); vp.setAttribute('name', 'viewport'); head.appendChild(vp); }
  vp.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
}
```

**Gate it on Teams.** Inside a Teams tab the page is yours alone; on a SharePoint page you'd be mutating global `<meta>` shared with the whole page and other web parts — don't.

## Notes

- Debug reflex: *"broken in Teams mobile, fine in any browser"* → fix the viewport **first**, then look at breakpoints and defensive wrapping. Measuring-based responsive providers only start telling the truth once the layout width is real.
- While you're in there: Teams also lacks the SP canvas padding (content glued to screen edges — give it a default 16 px when the host is Teams) and the dark-themed shell can bleed a dark background behind a light-only app (`color-scheme: light` on `<html>` helps).
- Some things genuinely can't be reproduced off-device. Say so in the commit/PR ("targeted fix based on webview behavior, verified on hardware") instead of pretending DevTools emulation covers it.
