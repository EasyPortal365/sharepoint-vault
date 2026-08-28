---
title: Deep-link parameter appended to a SharePoint page URL that already has one
tags: [spfx, routing, deep-link, url]
applies-to: SharePoint Online (SPFx web parts on Site Pages)
last-reviewed: 2026-08-28
---

# Deep-link parameter appended to a SharePoint page URL that already has one

> **Bottom line.** Building a deep link as `pageUrl + '&myparam=' + value` breaks whenever the stored `pageUrl` already carries `myparam` — `URLSearchParams.get()` returns the **first** occurrence, so the app opens whatever the old value said. Always *replace* the key, never append it.
>
> **Ve zkratce.** Odkaz skládaný jako `pageUrl + '&muj=' + hodnota` se rozbije, jakmile uložená `pageUrl` parametr už obsahuje – `URLSearchParams.get()` vrací **první** výskyt, takže se otevře stará hodnota. Klíč vždy *nahrazuj*, nikdy nepřipojuj.

## Why this bites SPFx specifically

An SPFx web part that does client-side routing typically encodes its view in a query parameter and rewrites the URL with `history.pushState`, e.g. `…/SitePages/App.aspx?myapp=dashboard`. Two consequences:

1. **The URL in the address bar always has the parameter.** Any admin asked to "paste the address of the page" pastes it *with* `?myapp=dashboard`, because that is what the browser shows after they have clicked around.
2. **A second app storing that address and appending its own parameter produces a duplicate key.** The target parses only the first one and silently lands on the wrong view.

The failure is nasty because the link *looks* correct — it navigates, the app loads, no error anywhere. Only the destination is wrong.

## The fix

Replace the key instead of appending it:

```js
/** Build `<page>?<key>=<value>`, dropping any pre-existing `<key>`. */
function pageLink(pageUrl, key, value) {
  const clean = (pageUrl || '').trim().split('#')[0];
  const q = clean.indexOf('?');
  const base = q === -1 ? clean : clean.slice(0, q);
  const rest = q === -1 ? '' : clean.slice(q + 1);
  const keep = rest.split('&').filter(p => p && p.split('=')[0].toLowerCase() !== key.toLowerCase());
  keep.push(key + '=' + value);
  return base.replace(/\/+$/, '') + '?' + keep.join('&');
}
```

`URL`/`URLSearchParams` do this for you (`u.searchParams.set(key, value)`), and `set()` correctly removes duplicates — but it needs an absolute URL and throws on a malformed one, so guard it if the value comes from a settings field a human typed.

## Testing note

**Test with a URL that already carries the parameter**, not with a clean one. A clean `…/App.aspx` produces `?myparam=x` and passes; the bug only appears with the realistic input — the address someone actually copied out of their browser. Same class of mistake as testing paging with fewer rows than one page.

## Related

- `spfx/server-request-path-is-not-the-page-url.md` — the other end of the same confusion: which URL you are even holding.
- `spfx/spa-router-hijacks-anchor-clicks.md` — navigating within a SharePoint page.
