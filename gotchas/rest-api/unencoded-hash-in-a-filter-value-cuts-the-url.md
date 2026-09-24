---
title: An unencoded `#` in a `$filter` value cuts the URL — SharePoint gets half a query and answers 400
short-title: An unencoded `#` in a `$filter` value cuts the URL
summary: The browser drops everything after `#` as a fragment, SharePoint gets an unterminated literal and answers 400; guest UPNs (`#EXT#`) always hit it; `&` cuts the expression and a raw `+` arrives as a space, so a valid literal silently matches nothing (measured) — `encodeURIComponent(odataString(x))`
tags: [rest-api, odata, filter, url-encoding, guests]
applies-to: SharePoint Online, SharePoint Server (any REST URL built by string concatenation, SPFx included)
last-reviewed: 2026-09-24
---

# An unencoded `#` in a `$filter` value cuts the URL — SharePoint gets half a query and answers 400

> **Bottom line.** A `#` inside a `$filter` value that you did not URL-encode starts the URL fragment. The browser sends only what comes before it and never tells you, so SharePoint receives an unterminated literal and answers 400. Escape the OData layer first, then the URL layer: `encodeURIComponent(odataString(value))`. Guest UPNs (`#EXT#`) and claims login names (`i:0#.f|…`) always contain a `#`. The same encoding covers `&` (cuts the expression) and `+` (arrives as a space — in a valid literal that is a silent "no match", not an error).
>
> **Ve zkratce.** Nezakódovaný `#` v hodnotě `$filter` začne fragment URL. Prohlížeč pošle jen to, co je před ním, a nic neřekne, takže SharePoint dostane neukončený literál a vrátí 400. Nejdřív escapuj vrstvu OData, pak vrstvu URL: `encodeURIComponent(odataString(value))`. UPN hostů (`#EXT#`) a claims login names (`i:0#.f|…`) obsahují `#` vždycky. Totéž kódování řeší `&` (utne výraz) a `+` (dorazí jako mezera – v platném literálu je to tiché „nic nenalezeno“, ne chyba).

## Symptom

A read that works for most records fails for some with **HTTP 400**, and the message quotes a value that is **shorter than the one your code sent**:

```
The expression "Title eq 'PollVotes…
```

Two shapes seen in one app on the same day:

- **Keys with a separator.** A per-user vote row keyed `<list>#<pollId>` (`PollVotes#5`). Reading "my vote" returned 400, the app treated that (correctly) as "unknown", and voting stopped working for everybody.
- **Guest accounts.** Filters on the user's UPN — "have I acknowledged this announcement", "my votes", "my reactions", a user lookup by e-mail — worked for members and failed only for guests, whose UPN looks like `megan_contoso.com#EXT#@fabrikam.onmicrosoft.com`.

Measured live: the same request with the raw value → 400; with the value encoded → 200.

`&` and `+` measured the same day with deliberately unterminated literals, so that the 400 message quotes exactly what the server received (`/_api/web/lists?$select=Title&$top=1&$filter=…`, read-only):

| `$filter` sent | Response |
|---|---|
| `Title eq 'Zk+Plus` | 400 `The expression "Title eq 'Zk Plus" is not valid.` — a raw `+` is read as a space |
| `Title eq 'Zk%2BPlus` | 400 `… 'Zk+Plus` — an encoded `+` arrives as `+` |
| `Title eq 'Zk&Amp' and Title ne 'x'` | 400 `The expression "Title eq 'Zk" is not valid.` — `&` ends the parameter |
| `Title eq 'Zk+Plus'` (a valid literal) | **200 with an empty result** — no error, nothing found |

The last row is the dangerous one: a plus-addressed e-mail (`megan+news@contoso.com`) used as the key of a per-user row is never found, and code that creates "my row" when it finds none creates another one on every save.

## Cause

Two escaping layers, and the code only handled one of them:

1. **OData literal** — an apostrophe inside `'…'` must be doubled. The code did that.
2. **URL** — `#` starts the fragment. `fetch` (and `SPHttpClient`, which sits on it) never sends the fragment to the server. Everything after the `#` disappears: the rest of the value, the closing apostrophe, and every parameter you appended after `$filter` — `$top`, a cache-buster, anything.

So SharePoint sees `$filter=Title eq 'PollVotes`, an unterminated string, and rejects the query. Nothing on the client side reports that the URL was cut.

## Fix

Escape for OData, then encode for the URL — in that order, for every dynamic value:

```ts
const odataString = (s: string): string => (s || '').split("'").join("''");

const filter = `Title eq '${encodeURIComponent(odataString(key))}'`;
const url = `${listUrl}/items?$select=Id,Choice&$filter=${filter}&$top=1`;
```

The same applies to other literals in a URL (`sitegroups/getbyname('…')`, parameter aliases such as `@u='…'`). File and folder **paths** are a different story: the classic `GetFolderByServerRelativeUrl('…')` / `GetFileByServerRelativeUrl('…')` cannot reach a name with `#` or `%` even when you encode it — see [A `#` or `%` in a file or folder name](hash-and-percent-in-file-names-need-the-resourcepath-api.md).

Values that may stay unencoded are the ones that **cannot** contain `#`, `&`, `+` or `%`: numeric ids, constants from your own code, dates from `toISOString()`, keys that passed a character allowlist. User input, UPNs, e-mail addresses, login names and keys joined with a `#` separator get encoded every time.

## Notes

- This is the other half of [Apostrophes in OData literals](odata-string-literals-and-apostrophes.md): `encodeURIComponent` alone does not escape `'`, and doubling apostrophes alone does not escape `#`. You need both.
- `&` and `+` are measured above; `%` (starts an escape sequence) breaks the URL for the same reason, which follows from URL syntax.
- The Microsoft Graph JavaScript client does not encode `$filter` values for you either: [The Graph JS client sends `$filter` values unencoded](../graph/graph-client-does-not-encode-filter-values.md).
- A code check that looks for the *shape* of a safe call (an AST rule over template literals) misses filters built with `+` concatenation and parameter aliases, and trusts any function that merely has the right name. A green check means "not in the shapes I measure".
- Test data rarely contains `#`, and test accounts are rarely guests — so this passes every happy-path test and fails for real users.
- Quick review check: search for `$filter=` built with template literals and look at every `${…}` inside quotes that is not wrapped in `encodeURIComponent`.
