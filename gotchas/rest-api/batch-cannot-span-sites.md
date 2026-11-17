---
title: "`$batch` cannot span sites – one batch asking several webs for the same list returns 400"
short-title: "`$batch` cannot span sites"
summary: "A SharePoint REST `$batch` is bound to the web whose `_api/$batch` endpoint you call; put requests to other site URLs in it and the whole batch fails with HTTP 400. For a tenant-wide read (one small GET per site), use a bounded worker pool of plain GETs with `Retry-After`, not one big batch"
tags: [rest-api, batch, search, throttling, multi-site, inventory]
applies-to: SharePoint Online REST (`/_api/$batch`), any client – SPFx `SPHttpClient`, PnPjs, plain fetch
last-reviewed: 2026-11-18
---

# `$batch` cannot span sites – one batch asking several webs for the same list returns 400

> **Bottom line.** An OData `$batch` in SharePoint Online belongs to the web whose `/_api/$batch` you post to. Requests inside it may target lists and items of *that* web; put in requests for other site URLs and the batch comes back **HTTP 400** – the whole batch, not just the foreign parts. For a "read one small thing from every site" job, the reliable shape is: find the sites with Search, then run plain GETs through a small worker pool (about 6 at a time, down to 2 after a 429, honouring `Retry-After`).
>
> **Ve zkratce.** `$batch` v SharePoint Online patří webu, na jehož `/_api/$batch` ho posíláš. Požadavky na seznamy jiných webů v něm skončí **HTTP 400 pro celý batch**. Pro úlohu „z každého webu přečti jednu malou věc“ najdi weby přes Search a pak pouštěj obyčejné GETy v malé frontě (asi 6 naráz, po 429 jen 2, s `Retry-After`).

## Symptom

You need the same small fact from every site in the tenant – the row of a status list, a property, a version number. Sending one request per site looks wasteful, so you build a single `$batch` with one GET per site URL and post it to the root site's `/_api/$batch`. It returns **400 Bad Request**, and none of the inner responses arrive. The same batch with requests to the root web's own lists works.

## Cause

A `$batch` is processed in the context of the web it was posted to (our reading of the behaviour, not a documented rule): the inner requests are resolved against that web, and requests for other site URLs are not routed elsewhere. There is no "tenant batch" in SharePoint REST.

Microsoft Graph has its own `$batch`, whose requests may address different sites (`/sites/{site-id}/lists/…`), but it is a different API with its own permissions and throttling, and it does not expose SharePoint REST endpoints such as `GetList(...)`.

## Fix – Search for the sites, then a bounded worker pool

```ts
// 1) Sites the CURRENT user can see – Search trims by permission, no admin API needed.
const q = "(contentclass:STS_Site OR contentclass:STS_Web)";
const url = `${webUrl}/_api/search/query?querytext='${encodeURIComponent(q)}'`
  + `&selectproperties='Title,Path'&rowlimit=500&startrow=${start}`;
// page with startrow until a short page; skip OneDrive (-my.sharepoint.com, /personal/)

// 2) One GET per site, at most N in flight.
async function pool<T>(items: T[], limit: number, fn: (x: T, slowDown: () => void) => Promise<void>) {
  let next = 0, cap = limit;
  const slowDown = () => { cap = Math.min(cap, 2); };
  const worker = async (id: number) => {
    while (next < items.length) {
      if (id >= cap) return;            // after a 429, extra workers retire
      await fn(items[next++], slowDown);
    }
  };
  await Promise.all(Array.from({ length: limit }, (_, i) => worker(i)));
}
// Inside fn: on 429/503 call slowDown(), wait Retry-After (cap ~30 s), retry up to 2×.
// 404 on the list = "not there"; 403/5xx = "unknown" – never report unknown as "fine".
```

Measured on a small tenant (40 sites): Search 0.65 s; one GET per site about 170 ms; six in parallel took about 1.1 s for all of them. At that rate a few thousand sites take a minute or two, which is acceptable for an admin screen you open on purpose.

## Notes

- **Search returns only sites the user can read.** That is the point for an admin-facing screen ("sites you have access to"), but say so in the UI – it is not a complete tenant inventory.
- **Distinguish "absent" from "unknown".** A 404 on a per-site list means the thing is not on that site; a 403 or 5xx means you do not know. Showing "unknown" as "up to date" is the classic way such dashboards lie.
- **A `$batch` within one web still pays off** when you have many reads or writes against the same site (for example, many items in one list).
- Related: [Unbounded `Promise.all` fan-out invites 429](unbounded-promise-all-fanout-throttling.md).
