---
title: Message Center via Graph — with $orderby you may get one page and no nextLink; page with $skip
short-title: serviceAnnouncement/messages stops at one page
summary: "`messages?$top=100&$orderby=…` returned 100 posts without `@odata.nextLink`; `$top` + `$skip` returned all 441"
tags: [graph, message-center, service-communications, paging, spfx]
applies-to: Microsoft Graph v1.0 /admin/serviceAnnouncement/messages (delegated, ServiceMessage.Read.All)
last-reviewed: 2026-10-24
---

# Message Center via Graph stops at the first page when sorted

> **Bottom line.** Reading `GET /admin/serviceAnnouncement/messages?$top=100&$orderby=lastModifiedDateTime desc` and following `@odata.nextLink` gave exactly **100** posts — the response carried no next link, so a "read until there's no nextLink" loop stopped and the UI said "100 of 100". Paging explicitly with `$top=100&$skip=0,100,200…` (stop when a page has fewer than 100 items) returned all **441** posts of the same tenant. Don't trust the absence of `nextLink` here as "that's everything".
>
> **Ve zkratce.** Dotaz `messages?$top=100&$orderby=lastModifiedDateTime desc` se smyčkou přes `@odata.nextLink` vrátil přesně **100** zpráv – odpověď další odkaz nenesla, smyčka skončila a obrazovka tvrdila „100 z 100“. Stránkování přes `$top=100&$skip=…` (konec, když stránka má méně než 100) vrátilo v témže tenantu všech **441** zpráv. Chybějící `nextLink` tu neznamená „to je všechno“.

## Symptom

A list of Message Center posts that is always exactly a round number (the `$top` value), no matter how many posts the admin center shows.

## Fix

```ts
const page = 100;
const all = [];
for (let skip = 0; skip < 500; skip += page) {
  const res = await graph
    .api(`/admin/serviceAnnouncement/messages?$top=${page}&$skip=${skip}&$orderby=lastModifiedDateTime desc`)
    .get();
  all.push(...res.value);
  if (res.value.length < page) break;   // last page
}
// a post may move between pages while you read — de-duplicate by id
```

- Keep a hard cap and tell the user when it was hit ("loaded the first 500 posts").
- De-duplicate by `id`: a post edited during the read moves in a `lastModifiedDateTime` sort.

## Notes

- Measured 2026-10-24 on one tenant with delegated `ServiceMessage.Read.All` from an SPFx web part (`MSGraphClientV3`). Whether the missing `nextLink` depends on `$orderby` or on the endpoint in general wasn't isolated — `$skip` paging works either way.
- The post `body.content` is HTML: render it as text, not markup.
