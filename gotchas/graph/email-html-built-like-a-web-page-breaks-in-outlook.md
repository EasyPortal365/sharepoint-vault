---
title: E-mail HTML built like a web page falls apart in Outlook
summary: "Classic Outlook renders with Word: no flexbox, rounded corners or gradients, so white text on a gradient vanishes; tables, solid colours, literal values, a full document, and under ~102 KB for Gmail"
tags: [graph, email, sendmail, html, outlook]
applies-to: HTML e-mail sent from your app (Microsoft Graph sendMail or any other channel); classic Outlook for Windows, Gmail
last-reviewed: 2026-09-24
---

# E-mail HTML built like a web page falls apart in Outlook

> **Bottom line.** Classic Outlook for Windows renders HTML mail with Word's engine, so a message built like a web page — `<div>` layout, flexbox, rounded corners, a gradient behind white text — arrives scattered, and text set on a gradient can vanish. Build mail from nested tables with solid colours and literal values inline, send a complete HTML document, and keep it small: Gmail clips messages over about 102 KB.
>
> **Ve zkratce.** Klasický Outlook pro Windows vykresluje HTML poštu enginem Wordu, takže zpráva postavená jako webová stránka – rozvržení z `<div>`, flexbox, zaoblené rohy, přechod za bílým textem – dorazí rozsypaná a text na přechodu může zmizet. Stav e-mail z vnořených tabulek s plnými barvami a hodnotami zapsanými přímo u prvků, posílej úplný HTML dokument a drž ho malý: Gmail zprávy nad zhruba 102 kB ořezává.

## Symptom

A news digest looks right in a browser preview. In desktop Outlook the header band has no background — it was a `linear-gradient` — so its white heading is invisible; rounded corners and shadows are gone; blocks stack without spacing. The message is also 171 kB.

## Cause

The HTML was a web page: a `<div>` root, layout through `<div>`s and CSS, a gradient as the only background of the header, `border-radius` and `box-shadow`, no `<!DOCTYPE>` and no `<body>`. Classic Outlook for Windows renders HTML mail with Word, which has no flexbox, ignores `border-radius` and `box-shadow`, and does not paint CSS gradients — the band came out white, with white text on it.

## Fix

1. **Tables, not `<div>`s.** `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640">`, nested tables for columns, `align` and `valign` as attributes.
2. **Never let contrast depend on a gradient.** Give a coloured band a solid `background-color`; a gradient may at most decorate on top of it.
3. **Send a complete document:** `<!DOCTYPE html><html><head><meta charset="utf-8">…</head><body>…</body></html>`.
4. **Literal values, inline.** No CSS custom properties — classic Outlook for Windows does not support them, and Gmail supports `var()` but not the declarations — and web-safe font stacks rather than your brand's web fonts.
5. **Keep it small.** Gmail clips messages larger than about 102 KB of HTML behind a "View entire message" link. Cap the items per section and link to the rest: our digest went from 171 kB to 12 kB.

## Notes

- If your codebase already sends well-formed mail somewhere, reuse that template. Writing a new one from scratch because "an e-mail is just HTML" is how this happens.
- [`/me/sendMail`: From is always the signed-in user](sendmail-from-is-the-signed-in-user.md) · [A pasted screenshot is too big for `/me/sendMail`](sendmail-attachment-size-ceiling.md)

## References

- [Does Outlook support border-radius? (Microsoft Q&A)](https://learn.microsoft.com/en-us/answers/questions/4622515/does-outlook-support-border-radius)
- [CSS variables in e-mail clients (Can I email)](https://www.caniemail.com/features/css-variables/)
- [How to keep Gmail from clipping your emails (Litmus)](https://www.litmus.com/blog/how-to-keep-gmail-from-clipping-your-emails)
