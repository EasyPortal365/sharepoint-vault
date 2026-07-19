---
title: Stored XSS via SharePoint list content — React won't save you
tags: [security, spfx, react, xss]
applies-to: SharePoint Online (any client rendering list data)
last-reviewed: 2026-07-16
---

# Stored XSS via SharePoint list content — React won't save you

> **Bottom line.** React won't block a `javascript:` href, `dangerouslySetInnerHTML`, or a CSS `url()` breakout, so list content any member can write is a stored-XSS vehicle — run every sink through an allowlist `safeHref` (strip C0 control characters first) plus a DOMParser-based sanitizer for SVG/HTML.
>
> **Ve zkratce.** React nezablokuje `javascript:` v href, `dangerouslySetInnerHTML` ani únik z CSS `url()`, takže obsah listu, který může zapsat kterýkoli člen, je nástroj pro stored XSS – každý výstupní bod prožeň přes allowlist `safeHref` (nejdřív strhni řídicí znaky C0) a SVG/HTML přes sanitizér nad DOMParserem.

## Symptom

None — that's the problem. The app works perfectly until a security review (or an attacker) notices that values written into a list by **any member or content editor** flow into the page as URLs, SVG icons, or HTML.

## Cause

Three rendering sinks that people assume React protects, and it doesn't:

1. **`<a href={valueFromList}>`** — React does **not** block `javascript:` URLs (it only logs a warning). A list column is a stored-XSS delivery vehicle with a friendly UI.
2. **`dangerouslySetInnerHTML`** — the name says it, yet "it's just an icon SVG from a config list" ships anyway. SVG can carry `<script>`, `<foreignObject>`, event handlers.
3. **Inline CSS `url("...")`** built by string concatenation — React escapes *HTML*, not the inside of a CSS string literal. A crafted value breaks out of the `url()` and injects arbitrary CSS (up to exfiltration tricks).

## Fix

One tiny module, used at **every** sink:

**`safeHref(url)`** — allowlist, not blocklist, and strip control characters *first*:

```ts
export function safeHref(raw: string | undefined): string | undefined {
  if (!raw) { return undefined; }
  // 1) strip whitespace + C0 controls (U+0000–U+0020): browsers strip them
  //    before parsing, so 'java\tscript:alert(1)' otherwise sneaks past checks
  let url = '';
  for (let i = 0; i < raw.length; i++) { if (raw.charCodeAt(i) > 0x20) { url += raw[i]; } }
  const lower = url.toLowerCase();
  if (/^(javascript|vbscript|data):/.test(lower)) { return undefined; }   // hard block
  if (/^https?:\/\//.test(lower) || /^(mailto|tel):/.test(lower)) { return url; }
  if (lower.indexOf('//') === 0) { return 'https:' + url; }               // protocol-relative → https
  if (url.indexOf('/') === 0) { return url; }                             // site-relative
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/.test(lower)) { return 'https://' + url; } // bare domain → https
  return undefined;                                                        // unknown scheme → no link
}
```

- Render the anchor **only when `safeHref` returns a value** — `<a href={undefined}>` looks like a link and does nothing.
- **SVG/HTML from lists** → a DOMParser-based sanitizer with an element/attribute **allowlist** (drop `script`, `foreignObject`, `iframe`, all `on*` attributes, `javascript:`/`data:` in `href`/`src`). **Never a regex-only sanitizer** — `java\tscript:` and nested tags walk right through.
- **CSS `url()`** — value must pass `safeHref` *and* contain no `"` or `)`.

## Notes

- The two traps that make naive implementations fail in *both* directions:
  - **Too loose:** checking `indexOf('javascript:')` without the C0-strip — bypassable with an embedded tab/newline.
  - **Too strict:** rejecting `www.company.com` (no scheme) — admins type that constantly; if `safeHref` returns `undefined` for it, your "Quick links" stop being clickable. Normalize bare domains to `https://` instead.
- Constants imported from your own code (a hardcoded icon SVG) don't need the sanitizer — the rule is about **data that a list writer controls**.
- `mailto:${email}` / `tel:${phone}` with a **fixed scheme** prefix are safe by construction — the scheme can't be spoofed by the interpolated part.
