---
title: "pageContext.site.serverRequestPath is not the page URL — it can hand you a REST endpoint"
tags: [spfx, page-context, url, configuration, spa]
applies-to: SharePoint Online (SPFx web parts and extensions that store "where the app lives")
last-reviewed: 2026-08-26
---

# `pageContext.site.serverRequestPath` is not the page URL — it can hand you a REST endpoint

> **Bottom line.** `serverRequestPath` is the path of the last **server request**, not the address of the page. On a modern list view it can be `/_vti_bin/client.svc/web/GetListUsingPath(DecodedUrl=@a1)/RenderListDataAsStream`. Store that as "the page where my app lives" and every link you build from it lands on an XML error. Validate before writing, validate again before rendering, and treat an already-stored bad value as something to repair rather than preserve.
>
> **Ve zkratce.** `serverRequestPath` je cesta posledního **serverového požadavku**, ne adresa stránky. V moderním zobrazení seznamu to může být `/_vti_bin/client.svc/web/GetListUsingPath(DecodedUrl=@a1)/RenderListDataAsStream`. Když si to uložíte jako „stránku, kde appka žije", každý odkaz z toho složený skončí na chybovém XML. Ověřujte před zápisem, ověřujte znovu před vykreslením, a už uloženou nesmyslnou hodnotu berte jako něco k opravě, ne k zachování.

## Symptom

Your solution stores the URL of the page hosting the full app, so that an extension elsewhere on the site can link to it. A user clicks that link and gets:

```xml
<m:error>
  <m:code>-1, Microsoft.SharePoint.Client.InvalidClientQueryException</m:code>
  <m:message xml:lang="en-US">Missing required query string: @a1.</m:message>
</m:error>
```

Reading the stored configuration shows the value is not a page at all — it is a SharePoint REST endpoint.

## Cause

The auto-detection wrote `window.location.origin + context.pageContext.site.serverRequestPath`.

The name suggests "the path of the current page". What it actually reflects is the path of the request that produced the current page context — and on a modern list view, with the list's own data call in flight, that can be the `RenderListDataAsStream` endpoint. The value is captured once, stored, and then quietly serves broken links forever.

There is a real reason people reach for `serverRequestPath` instead of `window.location`, and it is worth keeping: while a page is being **created**, `window.location` carries a temporary random draft name (`fwiepsou.aspx`) that SharePoint renames on publish. Store that and your link 404s. So neither source is trustworthy on its own.

## Fix

Validate the shape, then fall back — and refuse to store anything that does not look like a page.

```ts
const FORBIDDEN = ['/_vti_bin/', '/_api/', '/_layouts/', '/_forms/'];

export function isAppPageUrl(url: string): boolean {
  const raw = (url || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const isAbs = lower.indexOf('https://') === 0 || lower.indexOf('http://') === 0;
  if (!isAbs && lower.charAt(0) !== '/') return false;          // no javascript:, no data:

  let path = lower;
  if (isAbs) {
    const afterScheme = path.indexOf('://') + 3;
    const slash = path.indexOf('/', afterScheme);
    path = slash === -1 ? '/' : path.substring(slash);
  }
  const q = path.indexOf('?'); if (q !== -1) path = path.substring(0, q);   // SP appends ?web=1
  const h = path.indexOf('#'); if (h !== -1) path = path.substring(0, h);

  for (let i = 0; i < FORBIDDEN.length; i++) if (path.indexOf(FORBIDDEN[i]) !== -1) return false;
  return path.length > 5 && path.substring(path.length - 5) === '.aspx';
}
```

Then pick a source, in this order:

```ts
const fromContext = origin + context.pageContext.site.serverRequestPath;  // survives draft renames
const fromAddress = origin + window.location.pathname;                    // the address bar
const pageUrl = isEditMode() ? ''                                          // never store while editing
  : (isAppPageUrl(fromContext) ? fromContext
    : (isAppPageUrl(fromAddress) ? fromAddress : ''));                     // nothing valid → store nothing
```

**Three rules that make this stick:**

1. **Self-heal, do not preserve.** A stored value that fails validation should be cleared, not kept. Careful here: a "only overwrite values from the same site" guard sounds prudent, but the bad value typically points at a *different* path (often the tenant root), so it slips past that check and stays forever. Validity must win over origin-matching.
2. **Validate again at render time.** The consumer that builds the link should refuse to show it when the stored value is not a page. A missing link is better than a link into an error page.
3. **Test with the live sample.** Put the actual broken value from production into a unit test. A fixture invented from memory will never contain `GetListUsingPath(DecodedUrl=@a1)/RenderListDataAsStream`, which is exactly the shape that broke it.
