---
title: The Microsoft Graph JS client sends `$filter` values unencoded — `&` splits the query, `#` cuts it off
tags: [graph, spfx, msgraphclient, odata, filter, url-encoding, guests]
applies-to: "@microsoft/microsoft-graph-client 3.x (verified on 3.0.2) and SPFx MSGraphClientV3, which is built on it"
last-reviewed: 2026-09-24
---

# The Microsoft Graph JS client sends `$filter` values unencoded — `&` splits the query, `#` cuts it off

> **Bottom line.** The Graph JavaScript client (and SPFx's `MSGraphClientV3`, which wraps it) does not URL-encode anything you put into `.filter()`, `.query()` or the query string of `.api()`. A `#` in the value starts the URL fragment and the rest of the query never leaves the browser; an `&` splits the value into a second parameter — and with `.api('…?…')` the client even reassembles the query so that your `$top` lands in the middle of the filter. Escape the value yourself exactly as for SharePoint: double apostrophes, then `encodeURIComponent`.
>
> **Ve zkratce.** JavaScriptový klient Graphu (a `MSGraphClientV3` v SPFx, který ho obaluje) nic z toho, co dáš do `.filter()`, `.query()` nebo do dotazu v `.api()`, nekóduje pro URL. `#` v hodnotě začne fragment a zbytek dotazu z prohlížeče neodejde; `&` hodnotu rozdělí na další parametr – a u `.api('…?…')` klient dotaz poskládá znovu tak, že se tvůj `$top` ocitne uprostřed filtru. Hodnotu escapuj sám stejně jako pro SharePoint: zdvoj apostrofy, pak `encodeURIComponent`.

## Symptom

Filters that work for most people fail for some. The request that leaves the browser carries a filter cut short — usually an unterminated string literal, which is a request error rather than an empty result:

- a people search for "R&D", or for part of a guest's UPN (`megan_contoso.com#EXT#@…`);
- a mailbox query such as "messages from this contact" for an address that contains `#` or `&`;
- anything filtering on a display name, department or free text a user typed.

If you already fixed the same class of bug for SharePoint REST, this is the half that is still open: the Graph client looks like it builds URLs for you, so nobody encodes by hand.

## Measured

`@microsoft/microsoft-graph-client` 3.0.2, run in Node with a custom middleware that only captures the outgoing request (nothing sent to Graph). Value: `R&D #1 50% +x o'k`.

| Call | URL the client produced | What a server receives |
|---|---|---|
| `.api('/users').filter("startswith(displayName,'" + v + "')")` | `…/users?$filter=startswith(displayName,'R&D #1 50% +x o'k')` | `fetch` drops everything from `#`; the server sees `$filter=startswith(displayName,'R` plus a stray parameter `D ` |
| `.api("/users?$filter=startswith(displayName,'" + v + "')&$top=5")` | `…/users?$filter=startswith(displayName,'R&$top=5&D #1 50% +x o'k')` | **`$top` moved into the middle of the value**, then the same cut at `#` |
| `.api('/users').query({ $filter: "startswith(displayName,'" + v + "')" })` | same as the first row | same as the first row |
| `.api('/users').filter('startswith(displayName,' + literal(v) + ')')` | `…$filter=startswith(displayName,'R%26D%20%231%2050%25%20%2Bx%20o''k')` | the whole value: `'R&D #1 50% +x o''k'` |

We did not capture a live Graph response for these requests. Whether Graph reads a raw `+` as a space is an assumption here — SharePoint REST does (measured in [An unencoded `#` in a `$filter` value cuts the URL](../rest-api/unencoded-hash-in-a-filter-value-cuts-the-url.md)).

## Cause

Reading the client's source (`GraphRequest.js` in 3.0.2):

- `.filter(str)` stores the string as-is (`oDataQueryParams.$filter = filterStr`), and `createQueryString()` joins `key + "=" + value` with no encoding.
- `.api(path)` runs `parsePath`, which splits everything after `?` on `&`. An `&` inside a value therefore becomes a parameter boundary, and when the URL is rebuilt the OData parameters (`$filter`, `$top`, …) are written first and "other" parameters after them — which is how `$top` ends up inside your filter.
- The finished URL goes to `fetch`, so a `#` starts the fragment and the server never sees what follows.

## Fix

Encode the value, not the whole query, and pass it through the same helper you use for SharePoint:

```ts
/** OData string literal for a URL, quotes included: double apostrophes, then encode. */
const literal = (v: string) => "'" + encodeURIComponent(v.split("'").join("''")) + "'";

const users = await client.api('/users')
  .filter(`startswith(displayName,${literal(q)}) or startswith(mail,${literal(q)})`)
  .select('id,displayName,mail')
  .top(10)
  .get();
```

The client does not encode again, so there is no double encoding. Keep `$top`, `$select` and friends in their own builder calls rather than in the `.api()` string.

## Notes

- Values that are guaranteed not to contain `#`, `&`, `+` or `%` (GUIDs, numbers, constants from your own code) can stay as they are. UPNs, e-mail addresses and anything a user typed cannot — a guest's UPN always contains `#EXT#`.
- A code check that recognises filters by `$filter=` or ` eq '` in a template literal will not see `.filter(`startswith(displayName,'${q}')`)` — no marker, no finding. Test the helper with a fake client that cuts the URL at `#` and splits it on `&`; removing the encoding must make that test fail.
- Related: [SharePoint REST, same trap](../rest-api/unencoded-hash-in-a-filter-value-cuts-the-url.md) · [`MSGraphClient` calls bypass DevTools Network](msgraphclient-calls-bypass-devtools-network.md) — which is why you may not see the truncated URL in the browser either.
