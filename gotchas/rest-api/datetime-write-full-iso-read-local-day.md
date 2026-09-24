---
title: DateTime fields — write full ISO with a time zone, derive the day locally
tags: [rest-api, datetime, timezone]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
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

Test day logic in more than one zone, and prove the zone is real: run the calculation in a child process started with `TZ` set and assert the offset first — setting `TZ` inside Jest does nothing ([Setting `process.env.TZ` inside Jest does not change the time zone](../tooling/jest-process-env-tz-does-not-change-the-time-zone.md)).

## Notes

- Rule of thumb: **write `toISOString()`, read via local getters.**
- Watch every `slice(0, 10)` / `substring(0, 10)` on datetime strings in code review — each one is a suspect, unless the write stored the day as UTC midnight (see above).
