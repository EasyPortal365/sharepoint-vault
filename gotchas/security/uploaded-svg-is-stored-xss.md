---
title: An image upload that accepts image/* accepts SVG — and SVG is a script
tags: [security, spfx, rest-api, libraries]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-10
---

# An image upload that accepts `image/*` accepts SVG — and SVG is a script

> **Bottom line.** `file.type.indexOf('image/') === 0` lets `image/svg+xml` through. An SVG can carry `<script>` and `on*` handlers. Rendered through `<img src>` in your app it is inert, so the feature tests clean — but anyone who opens the file's **direct URL** in the library gets it inline, scripts and all, on your tenant's own origin. Allow-list raster types instead.
>
> **Ve zkratce.** Prefix `image/` propustí SVG, což je dokument se skriptem. V `<img>` se nespustí, ale přímá URL souboru v knihovně ho servíruje inline — stored XSS na doméně tenanta. Používej allowlist rastrových formátů.

## Symptom

Nothing, until someone looks. The picture renders as expected everywhere in the product, because `<img>` never executes script content. The payload only fires when the file is opened on its own:

```
https://contoso.sharepoint.com/sites/x/AppImages/1723-diagram.svg
```

That is a normal, shareable, indexable URL — often reachable by every member of the site, and reached most easily by pasting the link into a chat.

## Cause

MIME prefix checks treat SVG as "an image", which it is, in the way that a `.docx` is "a document": it is a full XML dialect with scripting, external references and CSS. The browser decides what to do with it based on how it is served, not on what your upload dialog thought it was.

Two more reasons the check is weaker than it looks:

- `file.type` comes from the **client** and is trivially forged; a hand-crafted request can send any value.
- Extension and MIME can disagree. Deriving the stored file name from `file.name` while validating `file.type` means the two can be validated and stored independently.

## Fix

**Allow-list, never prefix-match:**

```ts
const ALLOWED: { [mime: string]: boolean } = {
  'image/png': true, 'image/jpeg': true, 'image/jpg': true,
  'image/gif': true, 'image/webp': true, 'image/bmp': true, 'image/avif': true
};
if (!ALLOWED[(file.type || '').toLowerCase()]) throw new Error('Unsupported image format.');
```

Give SVG its own error message — users who tried it deserve to know why, and it stops the "the upload is broken" ticket.

Additional layers, in order of value:

1. **Validate the stored extension too**, not just the MIME. Derive it from an allow-list, not from the uploaded name.
2. **Restrict who can write to the library at all.** A library provisioned by an app usually inherits the web's permissions, so every member with Contribute can upload straight over REST regardless of what your UI allows.
3. If you genuinely need vector images, either sanitise them server-side or store them as raster renders. Client-side "sanitising" of an SVG before upload protects nobody: the attacker's request never runs your code.

## Why the app-level check is not the boundary

The upload dialog is UI. The library is the security boundary. Any file the library accepts is reachable through the REST API, the sync client, search results and direct links — regardless of which button in your product was supposed to be the only way in. Ask "who can PUT a file into this library" and answer it in permissions, then treat the client-side type check as a usability nicety.

## Related

- Stored XSS from list content — same class, different entry point.
- A document library provisioned by an app inherits the web's write permissions.
