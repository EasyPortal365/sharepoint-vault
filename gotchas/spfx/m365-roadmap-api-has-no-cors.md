---
title: The public Microsoft 365 roadmap JSON has no CORS headers — an SPFx web part can't fetch it
short-title: M365 roadmap API has no CORS
summary: "`releasecommunications/api/v1/m365` answers 200 without `Access-Control-Allow-Origin`; proxy it server-side"
tags: [spfx, cors, microsoft-365-roadmap, message-center, azure-functions]
applies-to: SharePoint Framework (browser), public Microsoft 365 roadmap API
last-reviewed: 2026-10-24
---

# The public Microsoft 365 roadmap JSON has no CORS headers

> **Bottom line.** `https://www.microsoft.com/releasecommunications/api/v1/m365` returns the whole public roadmap (about 2,200 items, ~3 MB) as JSON, but **without `Access-Control-Allow-Origin`**. A `fetch()` from a SharePoint page (`https://<tenant>.sharepoint.com`) is blocked by the browser, so an SPFx web part can't read it directly. Put a small server-side proxy in front of it (an Azure Function is enough), filter and shrink the payload there, cache it, and return CORS for your tenant origins.
>
> **Ve zkratce.** Veřejná roadmapa Microsoft 365 (`releasecommunications/api/v1/m365`) vrací JSON (asi 2 200 položek, ~3 MB), ale **bez hlavičky `Access-Control-Allow-Origin`** – `fetch()` ze stránky SharePointu prohlížeč zablokuje a SPFx ji přímo nepřečte. Dejte před ni malý serverový proxy (stačí Azure Function), tam data zužte a zmenšete, nacachujte a vraťte CORS pro originy tenantů.

## Symptom

```
Access to fetch at 'https://www.microsoft.com/releasecommunications/api/v1/m365'
from origin 'https://contoso.sharepoint.com' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

Measured with an `Origin` header (2026-10-24): `200 OK`, `Content-Type: application/json`, `Cache-Control: s-maxage=1800` — and no CORS header at all. A `HEAD` request even returns `403`, so don't use `HEAD` to probe it.

## Fix — a thin proxy

- Fetch the JSON server-side (with a timeout), keep only what you show: filter `tagsContainer.products` (e.g. `SharePoint`, `OneDrive`, `Microsoft Teams`, `Microsoft Copilot (Microsoft 365)`, `Microsoft Purview`), `tagsContainer.cloudInstances` = `Worldwide (Standard Multi-Tenant)`, drop `status: Cancelled`. That cut ~3 MB to ~800 KB (~270 KB gzipped).
- `description` is **HTML** — convert it to plain text on the server and render it as text in the web part; never inject it as HTML.
- Cache in memory for ~30 minutes (Microsoft itself sends `s-maxage=1800`) and serve the last good copy flagged as stale when the source is down.
- CORS: tenant origins can't be listed one by one, so allow a pattern such as `^https://[a-z0-9-]{1,63}\.sharepoint\.com$` — only on an endpoint that returns **public data and takes no input**. CORS is not authentication.

## Useful fields

`id`, `title`, `description` (HTML), `status` (`In development` · `Rolling out` · `Launched` · `Cancelled`), `publicDisclosureAvailabilityDate` (a month string like `December CY2026`), `publicPreviewDate`, `created`, `modified`, `tagsContainer.products / releasePhase / platforms / cloudInstances`.

A roadmap item opens in the browser at `https://www.microsoft.com/microsoft-365/roadmap?filters=&searchterms=<id>`.
