---
title: "Deduplicating events from an external API with a timestamp watermark silently drops simultaneous and late events"
short-title: "Event dedup by timestamp watermark loses events"
summary: When you pull activity events (opens, clicks, audit entries) in batches with an overlapping cursor, "skip anything not newer than the last counted event" throws away a second event with the same second-precision timestamp and any late-arriving event with an older timestamp — exactly the ones the overlap exists to catch; dedupe inside the overlap by event identity (action + timestamp + occurrence count) and let the watermark decide only what lies outside it
tags: [rest-api, integrations, sync, deduplication, cursor, email-marketing]
applies-to: Any client that ingests event streams from a third-party REST API (email activity, webhooks replayed by polling, audit logs) into SharePoint lists or other stores
last-reviewed: 2026-09-28
---

# Event dedup by timestamp watermark loses events

> **Bottom line.** Polling an event API with an overlapping cursor ("read from the last position minus ten minutes, events may land late") is the right design — but only if the consumer can tell an already-counted event from a new one *inside that overlap*. A single "last counted timestamp" cannot: it drops the second of two events recorded in the **same second** (Mailchimp, for example, counts a *click* as an *open* when the tracking image did not load, and both can carry the same timestamp) and every **late** event whose timestamp is older than one already counted. Let the watermark decide only what is older than the overlap; inside it, dedupe by event identity — action + timestamp, with an occurrence count — and keep that set only for the overlap window.
>
> **Ve zkratce.** Čtení událostí z cizího API s překryvem kurzoru („od poslední pozice minus deset minut, události chodí se zpožděním“) je správný návrh – ale jen když příjemce v tom překryvu pozná už započtenou událost od nové. Jediný „čas poslední započtené události“ to neumí: zahodí druhou ze dvou událostí zapsaných ve **stejné sekundě** (Mailchimp třeba počítá *proklik* i jako *otevření*, když se sledovací obrázek nenačetl, a obě můžou mít stejný čas) a každou **opožděnou** událost s časem starším než už započtená. Vodoznak ať rozhoduje jen o tom, co je starší než překryv; uvnitř něj deduplikuj podle identity události – akce + čas, i s počtem výskytů – a tu sadu drž jen pro okno překryvu.

## Symptom

The email platform's campaign report shows 1 open and 1 click for a recipient. Your app shows
"opened 1×" and no click — and the click never appears, no matter how many times you sync again,
even though the cursor re-reads the last ten minutes on every run.

## Why it happens

The per-recipient summary stored only the timestamp of the last counted event (`lastAt`) and skipped
anything not newer:

```ts
events.sort(byTimestamp).forEach(e => {
  if (lastAt && e.at <= lastAt) return;   // "already counted"
  count(e);
  lastAt = e.at;
});
```

Two ordinary situations break it:

1. **Same-second events.** Mailchimp counts a *click* as an *open* when the tracking image did not
   load ([About Open and Click Rates](https://mailchimp.com/help/about-open-and-click-rates/)) —
   common in mail clients that block images. In the case behind this article, the open and the
   click came back from the email-activity endpoint with the same one-second timestamp. The first
   one moves `lastAt`; the second is `<= lastAt` and is dropped — on this run and on every later
   re-read.
2. **Late events.** The overlap exists because an event can become readable later than its
   timestamp suggests. If the per-recipient watermark has already moved past that timestamp, the
   overlap re-reads the event and the watermark throws it away. The watermark defeats the overlap it
   relies on.

## Fix

```ts
const OVERLAP_MS = 10 * 60 * 1000;
// seen: { "o2026-09-28T10:46:03+00:00": 1, "k2026-09-28T10:46:03+00:00": 1 } – kept per recipient
const cutoff = lastAt ? Date.parse(lastAt) - OVERLAP_MS : NaN;
const batch: Record<string, number> = {};
events.sort(byTimestamp).forEach(e => {
  if (!isNaN(cutoff) && !(Date.parse(e.at) > cutoff)) return;  // older than the overlap
  const key = e.action[0] + e.at;
  batch[key] = (batch[key] || 0) + 1;
  if (batch[key] <= (seen[key] || 0)) return;                   // this occurrence already counted
  count(e);
  lastAt = lastAt && lastAt > e.at ? lastAt : e.at;             // never move backwards
});
// store max(seen, batch) per key, pruned to keys newer than lastAt - OVERLAP_MS
```

- Count occurrences, not just presence: two clicks on different links in the same second are two.
- Prune the set to the overlap window so it stays a handful of entries per recipient.
- Records written before the fix have no set. Derive it from what the summary knows (last open or
  last click equal to `lastAt` counts as seen once), so the next run picks up what was dropped.

## Tests worth having

- Two different actions with the same timestamp in one batch → both counted; re-read → no change.
- A late event older than the last counted one, inside the overlap → counted once; re-read → no change.
- Two identical actions in the same second → counted twice; re-read → still two.

"Re-reading the same events changes nothing" alone passes with the buggy watermark — it is the
simultaneous and the late case that expose it.
