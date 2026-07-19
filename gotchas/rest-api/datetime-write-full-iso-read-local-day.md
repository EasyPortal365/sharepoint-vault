---
title: DateTime fields — write full ISO with a time zone, derive the day locally
tags: [rest-api, datetime, timezone]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-15
---

# DateTime fields: write full ISO with a time zone, derive the day locally

> **Bottom line.** Write DateTime as a full ISO string via `toISOString()`, and derive the calendar day with local getters — slicing the UTC value SharePoint returns silently shifts the day for off-UTC users.
>
> **Ve zkratce.** DateTime zapisuj jako plné ISO přes `toISOString()` a kalendářní den odvozuj lokálními gettery – slice UTC hodnoty, kterou SharePoint vrací, den uživatelům mimo UTC tiše posune.

Two traps, one column type — one bites on write, the other on read.

## Trap 1: writing without a time zone → HTTP 400

### Symptom

```
Cannot convert the literal '2026-06-30T08:00:00' to the expected type 'Edm.DateTimeOffset'.
```

Typically after concatenating a date string by hand (`dateKey + 'T' + time`) — which is exactly what `<input type="datetime-local">` gives you.

### Fix

SharePoint REST wants a **full ISO 8601 value including the offset**. Run anything user-entered through `Date` first:

```ts
body: JSON.stringify({
  EventDate: new Date(localValue).toISOString()   // '2026-06-30T06:00:00.000Z'
})
```

## Trap 2: reading — the returned value is UTC, so `slice(0, 10)` shifts the day

### Symptom

Items saved for June 21 show up as June 20 in your UI — but only for some users, and never in your own quick tests.

### Cause

SharePoint returns DateTime values in **UTC**. Midnight June 21 in CEST is `2026-06-20T22:00:00Z` — take `value.slice(0, 10)` (or `toISOString().slice(0, 10)`) and you've got the previous day. It slips through happy-path testing because freshly created items often round-trip a date-only string from your own input.

### Fix

Derive calendar days **locally**, never from the UTC string:

```ts
const d = new Date(value);
const dayKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
```

If the value is a date-only string to begin with (`'2026-06-21'`), use it as-is — wrapping it in `new Date()` can shift it too, since date-only strings are parsed as UTC midnight.

## Notes

- Rule of thumb: **write `toISOString()`, read via local getters.**
- Watch every `slice(0, 10)` / `substring(0, 10)` on datetime strings in code review — each one is a suspect.
