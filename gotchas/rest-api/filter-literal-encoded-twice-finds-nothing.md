---
title: A `$filter` literal encoded twice finds nothing — with a 200
summary: If a helper already percent-encodes the quoted literal, wrapping the whole `$filter` in `encodeURIComponent` encodes the value a second time (`/` → `%252F`, `@` → `%2540`); SharePoint then compares against the escaped text and returns an empty result, no error; encode in exactly one layer and test with a fake server that decodes once and really filters
tags: [rest-api, odata, filter, encoding, testing]
applies-to: SharePoint Online REST (any client that builds `$filter` URLs by hand)
last-reviewed: 2026-11-12
---

# A `$filter` literal encoded twice finds nothing — with a 200

> **Bottom line.** Percent-encode a `$filter` value in exactly one place. If your literal helper already returns `'IT%2F2026'`, do not pass the whole filter through `encodeURIComponent` again — the server decodes once, compares against `IT%2F2026`, finds nothing and tells you so with an empty 200.
>
> **Ve zkratce.** Hodnotu ve `$filter` kóduj pro URL právě na jednom místě. Když pomocná funkce pro literál vrací už `'IT%2F2026'`, nežeň celý filtr ještě jednou přes `encodeURIComponent` – server dekóduje jen jednou, porovná s textem `IT%2F2026`, nic nenajde a oznámí to prázdnou odpovědí se stavem 200.

## Symptom

A query that works when typed into the browser console returns nothing from the code. No 400, no exception — an empty `value` array, from which the calling code draws a perfectly reasonable wrong conclusion:

- "My items" is empty although the user has items (filter on a UPN — `@` went out as `%2540`).
- A uniqueness check built the same way would report "this number is free" when it is not.
- An append-only number allocator, which re-reads the series after adding its row, never sees its own row and reports that it lost a race against other users — on a series nobody else is touching (filter on `IT/2026` — `/` went out as `%252F`).

The network tab shows the tell: **`%25` inside the filter value**.

Values that are plain ASCII letters and digits survive double encoding unchanged, which is why the same code "works" for a token or a numeric ID and fails for an e-mail address, a path-like series name or anything with diacritics or spaces.

## Cause

A common pattern is a helper that turns a value into an OData string literal *and* makes it URL-safe in one go:

```ts
// doubles the apostrophe, then percent-encodes, quotes included
function literal(v: string): string {
  return "'" + encodeURIComponent(v.replace(/'/g, "''")) + "'";
}
```

That is fine on its own. The trap is a second layer that does not know about the first:

```ts
// WRONG — the literal is already encoded; this encodes it again
url + '&$filter=' + encodeURIComponent('Series eq ' + literal(series));

// same thing hidden in a helper
function readWhere(filter: string) {
  return get(base + '/items?$filter=' + encodeURIComponent(filter));
}
readWhere('Upn eq ' + literal(upn));
```

SharePoint decodes the query string once. What it compares against is the *escaped* text, so the comparison is false for every row.

## Fix

Encode the value, not the expression, and leave the rest of the filter alone (the browser escapes spaces itself):

```ts
url + '&$filter=Series eq ' + literal(series) + '&$top=5000';
```

If a shared read helper encodes the whole filter, fix the **helper** — do not compensate at the call sites, or the next caller who uses the literal helper (as a linter or a review may require) reintroduces the bug.

## How to prove it, not just believe it

- **Test against a fake server that behaves like the real one:** decode the `$filter` exactly once and actually filter the rows by it. A fake that ignores the filter and returns every row lets the double-encoded version pass.
- **Use a value that needs encoding:** a slash, a diacritic and an apostrophe together (`KEY'Š/2026`), plus a second series that must *not* be counted.
- **Negative control:** put the extra `encodeURIComponent` back and watch the test fail. Here it failed on every case with exactly the error message seen in production.
- A grep for `encodeURIComponent(` whose argument contains the literal helper finds the existing occurrences in a codebase in seconds; a lint rule for the same shape keeps them out.

## Notes

- Related: [The browser cache answers your read-after-write check](browser-cache-answers-your-read-after-write-check.md) — the same "my own row is not there" symptom with a different cause. When an allocator or check-then-write loses against itself, look for `%25` in the URL *and* for a repeated URL before changing the algorithm.
