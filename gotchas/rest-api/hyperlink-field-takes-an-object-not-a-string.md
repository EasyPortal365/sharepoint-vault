---
title: A Hyperlink column takes an object, not a string
summary: "It reads back as `{ Description, Url }` (`[object Object]`, React #31) and a plain string fails the whole save with 400; one helper each way, 255-character address limit, scheme allowlist"
tags: [rest-api, lists, fields, hyperlink]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# A Hyperlink column takes an object, not a string

> **Bottom line.** Over REST a Hyperlink (URL) column is a complex value in both directions: it reads back as `{ Description, Url }`, and writing a plain string fails the **whole** request with HTTP 400. Convert at the boundary — one helper for reading, one for writing — so that no form field ever sends a bare string.
>
> **Ve zkratce.** Sloupec typu hypertextový odkaz (URL) je přes REST v obou směrech složená hodnota: čte se jako `{ Description, Url }` a zápis prostého řetězce shodí **celý** požadavek na HTTP 400. Převáděj na hranici – jeden helper pro čtení, jeden pro zápis –, aby žádné pole formuláře nikdy neposlalo holý řetězec.

## Symptom

Two faces of the same mistake, usually found in the same form:

- The column **displays as `[object Object]`** — or, in React, rendering dies with minified error #31 ("Objects are not valid as a React child") because the value went straight into JSX.
- **Saving fails** whenever the form sends the URL as a string: HTTP 400. The body carries every field of the form, so nothing is saved — not even the fields the user did not touch.

In the case we audited, the seed script worked only because it left the URL column out. The form did not.

## Cause

SharePoint stores a Hyperlink column as two parts, the address and its display text, and REST exposes it that way:

```json
"Website": { "Description": "Contoso", "Url": "https://contoso.com" }
```

The write side expects the same shape. A string where an object is expected makes the request invalid, and SharePoint rejects it as a whole.

## Fix

Convert at the boundary between your model and the REST body:

```ts
/** REST → UI: always a string. */
function urlFieldToString(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return (v as { Url?: string }).Url || '';
}

/** UI → REST: an object, or null to clear the column. */
function stringToUrlField(s: string | null | undefined): { Url: string; Description: string } | null {
  const t = (s || '').trim();
  if (!t) return null;
  const url = /^(https?|mailto|tel):/i.test(t) ? t
            : t.indexOf('//') === 0 ? 'https:' + t
            : 'https://' + t;                  // also defuses javascript: and other schemes
  if (url.length > 255) throw new Error('The address is longer than 255 characters.');
  return { Url: url, Description: t };
}

// plain JSON body, e.g. through SPHttpClient
body: JSON.stringify({ Title: title, Website: stringToUrlField(form.website) })
```

- Send `null` to clear the column.
- The address is limited to **255 characters** ([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/539652/hyperlink-columns-does-not-allow-more-than-255)). Tell the user rather than truncating silently — a cut-off URL is a broken link that saves without complaint.
- Route **every** writer through the helper. The bug survives when only the component that failed first gets fixed.

## Notes

- The scheme allowlist is not decoration: `javascript:alert(1)` typed into a URL field is stored as-is and becomes a live link wherever your code puts it into an `href` without checking the scheme. See [Stored XSS via list content](../security/stored-xss-from-list-content.md).
- Column and view formatting reads the same column its own way: `@currentField` is the address and `@currentField.desc` the display text ([formatting syntax reference](https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/formatting-syntax-reference)).
- [Minified React errors cheatsheet](../spfx/react-minified-errors-cheatsheet.md) — #31 is the rendering face of this trap.
