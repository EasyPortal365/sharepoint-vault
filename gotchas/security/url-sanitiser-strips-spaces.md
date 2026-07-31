---
title: Your URL sanitiser strips spaces — and every SharePoint file link 404s
tags: [security, xss, urls, sharepoint-online, spfx]
applies-to: SharePoint Online (any client-side code that sanitises link URLs)
last-reviewed: 2026-07-31
---

# Your URL sanitiser strips spaces — and every SharePoint file link 404s

> **Bottom line.** The control-character strip that protects you from `java<TAB>script:` covers `U+0000`–`U+0020`, and that range includes the plain space. Strip it from the value you *return* and `/Shared Documents/Report Q3.docx` silently becomes `/SharedDocuments/ReportQ3.docx` — a URL that does not exist. Strip aggressively to *decide*; return a value where the space survives as `%20`.
>
> **Ve zkratce.** Ořez řídicích znaků, který tě chrání před `java<TAB>script:`, pokrývá rozsah `U+0000`–`U+0020`, a v něm je i obyčejná mezera. Když ji odstraníš z VRACENÉ hodnoty, z `/Shared Documents/Report Q3.docx` se tiše stane `/SharedDocuments/ReportQ3.docx` — adresa, která neexistuje. Agresivně ořezávej jen pro ROZHODNUTÍ; vracej podobu, kde mezera přežije jako `%20`.

## Symptom

* A link rendered by your web part opens "The webpage cannot be found", even though the file is right there in the library.
* An in-app document preview falls back to the generic viewer instead of the Office embed viewer — because the REST lookup that resolves the file (`GetFileByServerRelativePath`) found nothing at the mangled path.
* Nothing is logged. The sanitiser returns a perfectly plausible-looking URL, so the failure surfaces only as a 404 at click time.
* Copying the link out of the page and comparing it with the real file URL is the first moment anyone notices that spaces are missing.

## Cause

The standard guard against scheme smuggling looks like this:

```ts
// Browsers strip whitespace and control characters from a URL *before* parsing the
// scheme, so `java<TAB>script:alert(1)` defeats a naive blocklist. Strip them first.
function stripControl(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x20) out += s.charAt(i);
  return out;
}
```

That is correct — as a *decision* step. The bug appears when the same string is also what the function hands back:

```ts
export function safeHref(raw: string): string | undefined {
  const cleaned = stripControl(raw);           // ← used for BOTH decision and output
  if (!isAllowedScheme(cleaned)) return undefined;
  return cleaned;                              // ← spaces are gone for good
}
```

`0x20` **is** the space. SharePoint paths contain spaces constantly: the default document library is literally `Shared Documents`, and file names come from humans. So every link to such a file is quietly corrupted.

Why it survives review: the guard is *security* code, so it gets tested with attack strings — `javascript:`, `vbscript:`, `data:text/html`, tab/newline/NUL variants. Those all still behave correctly. The regression lives entirely in the benign half of the input space, which nobody thinks to test.

## Fix

Split the two roles. Decide on the aggressively stripped string; return a gently cleaned one where the space is percent-encoded.

```ts
/** Decision only: matches what the browser does before parsing the scheme. */
function stripControl(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x20) out += s.charAt(i);
  return out;
}

/** The value that actually goes into href/src: drop C0 + DEL, encode the space. */
function forHref(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x20) out += '%20';
    else if (c > 0x1f && c !== 0x7f) out += s.charAt(i);
  }
  return out;
}

export function safeHref(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  const cleaned = stripControl(trimmed);     // decide on this
  if (!cleaned) return undefined;
  const out = forHref(trimmed);              // return this

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(cleaned);
  if (scheme) {
    const s = scheme[1].toLowerCase();
    return (s === 'http' || s === 'https' || s === 'mailto' || s === 'tel') ? out : undefined;
  }
  if (cleaned.indexOf('//') === 0) return 'https:' + out;
  return out;                                 // relative path / anchor / query
}
```

This keeps the protection intact, because the scheme decision is still made on the stripped form:

* `java<TAB>script:alert(1)` → stripped to `javascript:…` → not in the allowlist → `undefined`
* `java script:alert(1)` → same → `undefined`
* `" javascript:alert(1)"` → `.trim()` then stripped → `undefined`

Two details worth keeping:

* **Do not double-encode.** `%20` already present must be left alone — encode only literal spaces, don't run `encodeURI` over the whole string.
* **Trim before encoding**, not after; otherwise leading/trailing whitespace turns into `%20` and stays.

## Verify

Run the *compiled* function, not your reading of it, and test **both** halves of the input space:

```js
// must return undefined
'javascript:alert(1)', 'java\tscript:alert(1)', 'java script:alert(1)',
' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)',
'java\0script:alert(1)', 'vbscript:x', 'data:text/html;base64,PHM+', 'file:///C:/Windows/win.ini'

// must come back usable
'https://host/sites/a/Shared Documents/Report Q3.docx'  // → .../Shared%20Documents/Report%20Q3.docx
'https://host/sites/a/Shared%20Documents/A.docx'        // → unchanged, no double encoding
'/sites/a/Shared Documents/f.docx'                      // → /sites/a/Shared%20Documents/f.docx
'www.example.com'                                       // → https://www.example.com
'//host/x'                                              // → https://host/x
'mailto:a@example.com'                                  // → unchanged
```

To confirm on a real tenant, probe both spellings read-only from the browser console while signed in:

```js
const probe = u => fetch(u, { method: 'HEAD', credentials: 'include' }).then(r => r.status);
await probe('https://host/sites/a/SharedDocuments/ReportQ3.docx');      // 404 — the mangled form
await probe('https://host/sites/a/Shared%20Documents/Report%20Q3.docx'); // 200 — the real file
```

## Takeaway

A sanitiser has two jobs — *reject the dangerous* and *pass the legitimate* — and a test suite made only of attack strings verifies one of them. Whenever you harden an input guard, add the awkward-but-valid cases too: spaces, non-ASCII characters, already-percent-encoded sequences, long query strings.

If you check the fix by grepping a minified bundle, pick a control string that **must** be present regardless of implementation (the app version, say). Grepping for `javascript` fails on builds that use an allowlist and never contain that literal — and a false "not found" reads exactly like a missing fix.
