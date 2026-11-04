---
title: DateTime fields — write full ISO with a time zone, derive the day locally
short-title: "DateTime: write full ISO, derive days locally"
summary: No-timezone writes 400; UTC reads shift the day; read a day in the zone it was written in — including noon-UTC dates at UTC+12 to +14; a bare date in $filter is UTC midnight, so `le` drops the last day of a range
tags: [rest-api, datetime, timezone]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-11-04
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

## The exception: a day you stored as UTC midnight

"Derive the day locally" is right for values that came from **local** time — `toISOString()` of a local midnight or of a moment. Some code stores a plain calendar day as UTC midnight instead (`${day}T00:00:00Z`). For those values the day **is** the UTC part of the string, and `value.substring(0, 10)` is correct. "Fixing" it to local getters shifts the day back by one for every user west of Greenwich, where UTC midnight is still the previous evening.

The rule that covers both cases: **read the day in the time zone it was written in.** Before you replace a `substring(0, 10)` with a local-day helper, find the write. One app had both conventions side by side — a licence date written from local time (read locally) and a collection date written as UTC midnight (read from the UTC part) — and only a comment kept the second one from being "corrected".

## Noon UTC — the popular compromise, and its edge at UTC+12

Storing a date-only value as **12:00 UTC** (`${day}T12:00:00Z`) is a common fix for the midnight problem: read as a local day it gives the same date everywhere from UTC−12 to UTC+11. Two edges remain, and both showed up when the same code was tested in three time zones:

- **UTC+12 to +14** (New Zealand, Fiji, Tonga, Kiribati): noon UTC is already the next day there. Reading your own noon value as a *local* day shows the day after — pinned by a test that ran in `Pacific/Kiritimati` (UTC+14). Read your own noon writes as the **UTC** date instead, and everything else (dates typed into SharePoint's own forms) as the local day.
- **The price of that rule:** a date entered in SharePoint's form on a site in *exactly* UTC+12 is stored as local midnight = 12:00 UTC of the previous day, looks exactly like your own noon write, and is read one day early. Accept it knowingly, or store the convention explicitly (a separate column, or a time other than noon).

Two more things the three-zone test surfaced:

- **Old values keep their old convention.** After switching from UTC midnight to noon, legacy UTC-midnight values still read correctly in Europe and in Kiribati, and one day early in New York.
- **"Today" in a server-side filter is an instant, not a day.** A token that expands to `datetime'<now>'` compares a noon-stored expiry against the current moment, so the item flips to "expired" at 12:00 UTC while your app — comparing days — still says "valid until the end of today". Whoever compares against the stored day from outside (a filter, a flow, a search query) must use the same convention.

## Trap 3: a bare date in `$filter` is UTC midnight — `le 'last day'` drops the last day

### Symptom

A month view built with `$filter=EventDate ge '2026-11-01' and EventDate le '2026-11-30'` never shows items on November 30, and a "days booked this month" count is one short. Measured live: `ge '2026-09-28' and le '2026-09-29'` returned only the item from the 28th; the item at `2026-09-29T07:00:00Z` (9:00 local on the 29th) was missing, while `lt '2026-09-30'` returned both.

### Cause

A bare date in an OData filter over a DateTime column is an **instant — midnight UTC** — not "the whole day". Anything stored with a time on the last day (a morning start, or the noon convention above) is after that instant. The lower bound has the mirror trap: an item stored as *local* midnight is the previous evening in UTC, and `ge 'first day'` misses it.

### Fix

Query a window one day wider on both sides with a strict upper bound, then trim by the **local** day in code — once, in the service, not in every caller:

```ts
const from1 = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
const to2 = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 2);
const filter = `EventDate ge '${dayKey(from1)}' and EventDate lt '${dayKey(to2)}'`;
// …fetch…
return rows.filter(r => { const d = localDay(r.EventDate); return d >= from && d <= to; });
```

The same applies to "overdue" checks: `DueDate lt 'today'` flags an invoice as overdue on its due date if the date was stored as local midnight. Query `lt 'tomorrow'` and compare local days in code. Test it with an item on the **last** day that has a time — sample data stored at 00:00 hides the bug.

Test day logic in more than one zone, and prove the zone is real: run the calculation in a child process started with `TZ` set and assert the offset first — setting `TZ` inside Jest does nothing ([Setting `process.env.TZ` inside Jest does not change the time zone](../tooling/jest-process-env-tz-does-not-change-the-time-zone.md)).

## Notes

- Rule of thumb: **write `toISOString()`, read via local getters.**
- Watch every `slice(0, 10)` / `substring(0, 10)` on datetime strings in code review — each one is a suspect, unless the write stored the day as UTC midnight (see above).
