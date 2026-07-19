---
title: SP.WebProxy is add-in-only — from SPFx it 403s with "without an app context"
tags: [spfx, rest-api, cors, webproxy]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# `SP.WebProxy` is add-in-only — from SPFx it 403s with "without an app context"

> **Bottom line.** `SP.WebProxy` is legacy add-in-only, so from SPFx it returns a fake HTTP 200 whose body is really a 403 — there is no SharePoint-native CORS proxy for SPFx, so make the target send the CORS header or fetch through your own backend.
>
> **Ve zkratce.** `SP.WebProxy` patří jen do starého add-in modelu, takže ze SPFx vrátí falešnou HTTP 200, jejíž tělo je ve skutečnosti 403 – žádná nativní SharePoint CORS proxy pro SPFx neexistuje, takže ať cíl pošle CORS hlavičku, nebo načítej přes vlastní backend.

## Symptom

You need to read a cross-origin page or API from an SPFx web part. The browser blocks the
direct `fetch` (the target sends no `Access-Control-Allow-Origin`), so you reach for
SharePoint's own server-side proxy:

```
POST /_api/SP.WebProxy.invoke
{"requestInfo":{"__metadata":{"type":"SP.WebRequestInfo"},"Url":"https://example.com","Method":"GET"}}
```

The call **returns HTTP 200** — and yet you get no content. The real answer is buried in the
response body:

```json
{"d":{"Invoke":{"__metadata":{"type":"SP.WebResponseInfo"},
  "Body":"Calls to WebProxy without an app context are not allowed.",
  "Headers":{"results":[]},
  "StatusCode":403}}}
```

This happens even though you are signed in and passed a valid `X-RequestDigest`.

## Cause

`SP.WebProxy` belongs to the **legacy SharePoint Add-in model**. It only serves callers running
in an *add-in context*, where the remote host is declared up front in the add-in's
`AppManifest.xml`:

```xml
<RemoteEndpoints>
  <RemoteEndpoint Url="https://example.com" />
</RemoteEndpoints>
```

SPFx web parts and extensions do **not** run in an add-in context — they are page-hosted script.
There is no manifest in which to declare a remote endpoint, so the proxy refuses every call,
regardless of permissions, digest, or site collection settings.

**There is no SharePoint-native CORS proxy available to SPFx.**

## Fix

Pick one of these — in this order:

1. **Make the target allow you.** If the URL is yours (your website, intranet, internal API),
   add the header on that side:
   `Access-Control-Allow-Origin: https://contoso.sharepoint.com`. Zero infrastructure, and it
   covers the common "read our own web properties" case.
2. **Fetch server-side from your own backend** (Azure Function, or whatever you already run) and
   have SPFx call that. The only option that works for arbitrary third-party pages. If you do
   this, treat the endpoint as an **SSRF target**: allow `http(s)` only, block private ranges
   (`10.x`, `192.168.x`, `127.x`, `169.254.x`, `::1`) — re-check **after every redirect** — and
   cap response size and timeout.
3. **Public CORS proxies** (`allorigins`, `codetabs`, `corsproxy`, `r.jina.ai`): they work until
   they don't, and every URL you request travels through a stranger's server. Fine for a public
   RSS demo; not fine for anything a customer would call confidential.

## Notes

- **The 200-that-isn't trap:** the outer HTTP status reports on the OData envelope, not on the
  proxied request. A naive `if (res.ok)` treats this failure as success. The real status lives at
  `d.Invoke.StatusCode`, and the error text at `d.Invoke.Body` — check those, not `res.ok`.
- **Don't confuse "we trust this URL" with CORS.** An allowlist you configure says *you* trust the
  target. CORS is the **target** granting *your origin* permission to read it. Only the second one
  unblocks the browser, and only the target can grant it — no amount of configuration on your side
  substitutes for it.
- Probe it yourself from any modern page on the site (F12 console): POST `/_api/contextinfo` for
  the digest, then POST `SP.WebProxy.invoke` as above and read `d.Invoke.StatusCode`.
