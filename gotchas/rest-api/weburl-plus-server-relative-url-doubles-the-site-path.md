---
title: webUrl + a server-relative URL doubles the site path
short-title: "`webUrl + serverRelativeUrl` doubles the site path"
summary: Survives for months as a display value or grouping key and breaks the first time it becomes a filter; build object URLs from the origin in one helper
tags: [rest-api, urls, spfx, data-quality]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# `webUrl + serverRelativeUrl` doubles the site path

> **Bottom line.** A server-relative URL already starts with the site path, so appending it to the web's absolute URL produces `…/sites/projects/sites/projects/Lists/Tasks`. Such an address can live for months as a display value or a grouping key and break only on the day it first becomes a link or a filter. Build object URLs in one helper, from the *origin* plus the server-relative path.
>
> **Ve zkratce.** Server-relativní adresa už cestou webu začíná, takže připojená za absolutní adresu webu vyrobí `…/sites/projects/sites/projects/Lists/Tasks`. Taková adresa může měsíce přežívat jako zobrazovaná hodnota nebo klíč pro seskupení a rozbije se až ve chvíli, kdy z ní poprvé bude odkaz nebo filtr. Adresy objektů skládej v jednom helperu z *originu* a server-relativní cesty.

## Symptom

A report or a history view shows object URLs that nobody has ever clicked. Everything works — until the same value is used as a query input for the first time. In our case a crawl-log lookup for a list with 108 entries came back "no records", and there was nothing wrong with the crawl log.

## Cause

Two URL flavours meet in one expression:

```ts
const webUrl  = this.context.pageContext.web.absoluteUrl;  // https://contoso.sharepoint.com/sites/projects
const listRel = '/sites/projects/Lists/Tasks';              // what GetList('…') wants: server-relative

const wrong = webUrl + listRel;
// https://contoso.sharepoint.com/sites/projects/sites/projects/Lists/Tasks
```

The value was consistent, which is exactly why it survived: as a grouping key it grouped correctly, as a display value nobody read it closely, and nobody clicked it — a link would have been an instant 404. It failed only when it had to *match* something.

## Fix

One helper, used everywhere an object's absolute URL is needed — key, report, deep link, filter:

```ts
function objectAbsUrl(webUrl: string, serverRelUrl: string): string {
  return new URL(webUrl).origin + serverRelUrl;
}
```

`new URL(serverRelUrl, webUrl).href` works too — a path that starts with `/` replaces the base's whole path — but it percent-encodes spaces while the concatenation keeps them as they came. Pick one form and compare [decoded](../search/compare-sharepoint-paths-decode-first.md).

## Notes

- **A value that is only displayed is not verified.** Before an address becomes a query input, run the query once against an object you know has results. An empty answer on a known-positive control points at your input, not at the data.
- Fix every place that builds the address, not just the one that failed: the history key, the report, the finding list and the filter had all been built the same way.
