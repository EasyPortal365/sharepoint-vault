---
title: ViewsX managed properties — sortable only by ViewsLifeTime
tags: [search, analytics, managed-properties]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# ViewsX managed properties: sortable only by `ViewsLifeTime`

> **Bottom line.** Of the ViewsX analytics properties only `ViewsLifeTime` sorts reliably, so sort by it and do the time-windowing client-side — the windowed variants like `ViewsLast7Days` select fine but break in `sortlist`.
>
> **Ve zkratce.** Z analytických vlastností ViewsX řadí spolehlivě jen `ViewsLifeTime`, takže řaď podle ní a časové okno dopočítej na klientu – okenní varianty jako `ViewsLast7Days` se dají vybrat, ale v `sortlist` selhávají.

## Symptom

Building a "most read this week" widget on SP Search, you sort by the obvious property:

```
sortlist='ViewsLast7Days:descending'
```

The query returns **nothing** (or garbage order). Sorting by `ViewsLastMonths1` — same. Yet both properties *select* just fine, so the data clearly exists.

## Cause

Of the analytics-backed managed properties, only **`ViewsLifeTime`** behaves as a reliable sort key. The windowed variants (`ViewsLast7Days`, `ViewsLastMonths1`, …) work as `selectproperties` but not dependably in `sortlist` — and to add insult, `ViewsLast7Days` often reports `0` across the board anyway.

## Fix

One query, sorted by the property that works; do the windowing client-side:

```
querytext='…'&sortlist='ViewsLifeTime:descending'
&selectproperties='Title,Path,ViewsLifeTime,ViewsLast7Days,ViewsLastMonths1'
```

Take a generous `rowlimit`, then re-rank/filter in code with whatever window values came back — with a fallback to lifetime views when the windowed numbers are zeros.

## Notes

- Tempted by Graph instead? `GET /sites/{id}/analytics` returns **HTTP 200 with `allTime: null`** on many tenants — check for the 200-with-null case before trusting it, and fall back to `getActivitiesByInterval(...interval='day')` (max ~90 days) when you need real numbers.
- Search analytics lag by design (hours to days) — don't promise real-time popularity, whatever property you sort by.
