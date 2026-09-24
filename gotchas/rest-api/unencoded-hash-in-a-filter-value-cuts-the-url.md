---
title: An unencoded `#` in a `$filter` value cuts the URL — SharePoint gets half a query and answers 400
tags: [rest-api, odata, filter, url-encoding, guests]
applies-to: SharePoint Online, SharePoint Server (any REST URL built by string concatenation, SPFx included)
last-reviewed: 2026-09-24
---

# An unencoded `#` in a `$filter` value cuts the URL — SharePoint gets half a query and answers 400

> **Bottom line.** A `#` inside a `$filter` value that you did not URL-encode starts the URL fragment. The browser sends only what comes before it and never tells you, so SharePoint receives an unterminated literal and answers 400. Escape the OData layer first, then the URL layer: `encodeURIComponent(odataString(value))`. Guest UPNs (`#EXT#`) and claims login names (`i:0#.f|…`) always contain a `#`.
>
> **Ve zkratce.** Nezakódovaný `#` v hodnotě `$filter` začne fragment URL. Prohlížeč pošle jen to, co je před ním, a nic neřekne, takže SharePoint dostane neukončený literál a vrátí 400. Nejdřív escapuj vrstvu OData, pak vrstvu URL: `encodeURIComponent(odataString(value))`. UPN hostů (`#EXT#`) a claims login names (`i:0#.f|…`) obsahují `#` vždycky.

## Symptom

A read that works for most records fails for some with **HTTP 400**, and the message quotes a value that is **shorter than the one your code sent**:

```
The expression "Title eq 'PollVotes…
```

Two shapes seen in one app on the same day:

- **Keys with a separator.** A per-user vote row keyed `<list>#<pollId>` (`PollVotes#5`). Reading "my vote" returned 400, the app treated that (correctly) as "unknown", and voting stopped working for everybody.
- **Guest accounts.** Filters on the user's UPN — "have I acknowledged this announcement", "my votes", "my reactions", a user lookup by e-mail — worked for members and failed only for guests, whose UPN looks like `megan_contoso.com#EXT#@fabrikam.onmicrosoft.com`.

Measured live: the same request with the raw value → 400; with the value encoded → 200.

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

The same applies to other literals in a URL (`GetFolderByServerRelativeUrl('…')`, `sitegroups/getbyname('…')`, parameter aliases).

Values that may stay unencoded are the ones that **cannot** contain `#`: numeric ids, constants from your own code, dates from `toISOString()`, keys that passed a character allowlist. User input, UPNs, e-mail addresses, login names and keys joined with a `#` separator get encoded every time.

## Notes

- This is the other half of [Apostrophes in OData literals](odata-string-literals-and-apostrophes.md): `encodeURIComponent` alone does not escape `'`, and doubling apostrophes alone does not escape `#`. You need both.
- `&` (ends the parameter) and `%` (starts an escape sequence) break the URL for the same reason. That follows from URL syntax; only `#` was measured here.
- Test data rarely contains `#`, and test accounts are rarely guests — so this passes every happy-path test and fails for real users.
- Quick review check: search for `$filter=` built with template literals and look at every `${…}` inside quotes that is not wrapped in `encodeURIComponent`.
