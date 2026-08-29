---
title: A screenshot pasted into a support form is too big for /me/sendMail — shrink it client-side
tags: [graph, mail, sendmail, attachments, spfx, clipboard]
applies-to: Microsoft Graph (/me/sendMail, delegated Mail.Send), SPFx / browser clients
last-reviewed: 2026-08-29
---

# A screenshot pasted into a support form is too big for /me/sendMail — shrink it client-side

> **Bottom line.** `POST /me/sendMail` carries attachments inline as base64 `fileAttachment`, and the whole request is capped at roughly 4 MB. Base64 inflates payloads by ~33 %, so the practical ceiling is about 2.5–3 MB of raw file — while a full-screen PNG from a 4K display is routinely 3–6 MB. The most ordinary thing a user can do (press PrintScreen, paste into your form) therefore fails on the very first try. Don't raise the limit — shrink the image in the browser: draw it into a canvas at a bounded longest edge, re-encode as JPEG, and keep the original only when it is already smaller. Above ~3 MB there is no `sendMail` fix at all: you must create a draft, upload the attachment through an upload session, then send it — three calls instead of one.
>
> **Ve zkratce.** `POST /me/sendMail` veze přílohy jako base64 přímo v těle a celý požadavek má strop kolem 4 MB. Base64 nafoukne data o ~33 %, takže reálně projde 2,5–3 MB původního souboru — jenže celoobrazovkový PNG ze 4K monitoru mívá 3–6 MB. Nejběžnější uživatelská akce (PrintScreen → Ctrl+V do formuláře) tedy selže hned napoprvé. Limit nezvyšujte, obrázek zmenšete v prohlížeči: vykreslit do canvasu na omezenou delší stranu, uložit jako JPEG a originál nechat jen tehdy, když je menší. Nad ~3 MB `sendMail` nepomůže vůbec — je potřeba koncept + upload session + odeslání, tedy tři volání místo jednoho.

## Symptom

A "report a problem" form sends the report through Graph from the signed-in user:

```js
await client.api('/me/sendMail').post({
  message: {
    subject, body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: 'support@example.com' } }],
    attachments: [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'screenshot.png', contentType: 'image/png',
      contentBytes: base64   // <- inline, counts against the request size
    }]
  },
  saveToSentItems: false
});
```

It works in testing with a cropped screenshot and fails for real users, who press PrintScreen and paste the whole desktop. Depending on the client you get a `413`, a `RequestEntityTooLarge`, or a generic failure — none of which says "your screenshot is 5 MB".

## Why

Two multipliers stack:

1. **`sendMail` is a single request.** Attachments are not uploaded separately; `contentBytes` sits in the JSON body, so the attachment, the HTML body and the envelope share one size budget (~4 MB).
2. **base64 costs 33 %.** 3 MB of PNG becomes ~4 MB of `contentBytes` on its own — over budget before the body is even added.

And screenshots are large: PNG is lossless and a 4K desktop full of text compresses badly. A 1920×1080 window crop lands around 200–600 kB; a full 3840×2160 screen commonly hits 3–6 MB.

## Fix

**Shrink before attaching.** In the browser, only bitmaps need this — do it above a threshold so small screenshots stay pixel-exact:

```js
function shrinkImage(dataUrl, maxDim, quality) {         // e.g. 1800, 0.85
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const g = canvas.getContext('2d');
      if (!g) { resolve(dataUrl); return; }
      g.fillStyle = '#ffffff';                            // PNG transparency -> black in JPEG
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/jpeg', quality);
      resolve(out.length < dataUrl.length ? out : dataUrl); // never make it bigger
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
```

Four details that matter in practice:

- **Fill the canvas white first.** A PNG with transparency re-encoded as JPEG renders the transparent pixels black — a screenshot with rounded window corners comes out framed in black.
- **Keep the original when it is smaller.** Re-encoding a small, already-compressed image usually grows it.
- **Never send an SVG through the canvas** — and don't render one as a preview either. An `image/` MIME prefix admits `image/svg+xml`, which is script-capable; treat it as a plain file attachment with a generic icon.
- **Enforce a total, not just a per-file limit.** Five 600 kB images pass a per-file check and still blow the request budget. Track the running sum and refuse the file that would cross it, naming the limit in the message.

**Reading the file:** in a browser-targeted build without `Blob.arrayBuffer()` (ES2015 lib), use `FileReader.readAsDataURL` and strip the `data:<mime>;base64,` prefix for `contentBytes`. The byte length hidden in a data URL is `floor(base64.length * 3 / 4)` minus padding — compute it instead of trusting `File.size`, which describes the *original*, not your re-encoded copy.

**Above the ceiling** there is no `sendMail` variant that helps. Create the message as a draft (`POST /me/messages`), attach through an upload session (`POST /me/messages/{id}/attachments/createUploadSession`, then chunked `PUT`s), and send it (`POST /me/messages/{id}/send`). That is a different feature, not a bigger limit — decide up front which one you are building.

## Fallback paths lose attachments entirely

If your form falls back to `mailto:` when Graph is unavailable (no mailbox, no consent), remember that **`mailto:` cannot carry attachments at all**, and its body has a practical URL length limit of roughly 2000 characters — non-ASCII text inflates about 3× once encoded. Cap the body, put the full text on the clipboard, and say explicitly which files the user has to attach by hand. Silently dropping them is worse than the original failure: the user believes the screenshot went out.
