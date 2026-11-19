---
title: "Graph /me/onlineMeetings lookup: 403 \"3003\" is not a consent problem"
short-title: "`/me/onlineMeetings` 403 3003 ≠ consent"
summary: "Looking up a meeting by JoinWebUrl returns 403 \"3003: User does not have access to lookup meeting\" for attendees of someone else's meeting, even with OnlineMeetingTranscript.Read.All consented"
tags: [graph, teams, onlinemeetings, transcripts, 403, consent]
applies-to: Microsoft Graph (Microsoft 365, delegated)
last-reviewed: 2026-11-20
---

# Graph `/me/onlineMeetings?$filter=JoinWebUrl eq '…'`: 403 "3003" means "not your meeting", not "missing consent"

> **Bottom line.** To read a Teams transcript in delegated mode you first resolve the meeting with `GET /me/onlineMeetings?$filter=JoinWebUrl eq '<encoded url>'`. For a meeting **organised by someone else**, Graph answers `403 Forbidden` with the message `3003: User does not have access to lookup meeting` — even when `OnlineMeetings.Read` and `OnlineMeetingTranscript.Read.All` are consented. Treat it as "the transcript of this meeting is not available to this user", never as "ask your admin for consent".
>
> **Ve zkratce.** Vyhledání schůzky podle `JoinWebUrl` vrací u schůzky jiného pořadatele `403` se zprávou „3003: User does not have access to lookup meeting“ – i s uděleným souhlasem. Je to „přepis této schůzky není dostupný“, ne „chybí souhlas správce“.

## Symptom

Your feature reads transcripts of the user's recent Teams meetings (from `calendarView` → `onlineMeeting.joinUrl`). For some meetings the lookup fails with 403 and your error mapping — "403 on the meeting lookup = consent missing" — tells the user to ask the admin to approve permissions. The admin already did.

## Cause

`/me/onlineMeetings` only resolves meetings the signed-in user is allowed to look up. Measured (November 2026, delegated token from SPFx): an attendee of a meeting organised by a colleague got `403` with the text code **3003**, while consent was in place. The error object has a generic `code: "Forbidden"`; the distinguishing part is only in `message` (or the raw response body), so a mapping based on status + code alone misclassifies it.

## Fix

Check the message and body for `3003` before any generic "403 = consent" rule:

```ts
function lookupFailKind(e: { statusCode?: number; message?: string; body?: unknown }): 'unavailable' | 'consent' | 'other' {
  if (e.statusCode !== 403) return 'other';
  const text = String(e.message || '') + ' ' + (typeof e.body === 'string' ? e.body.slice(0, 500) : '');
  if (/\b3003\b|does not have access to lookup meeting/i.test(text)) return 'unavailable';
  return 'consent';
}
```

Show the user something like "The transcript of this meeting is not available to you (for example, someone else organised it)."

## How to test

Measure the positive path only on a meeting **organised by the signed-in account** with transcription turned on. Testing with a meeting you merely attended measures meeting access, not transcript access.
