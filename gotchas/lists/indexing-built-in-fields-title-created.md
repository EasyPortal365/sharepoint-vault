---
title: Title and Created are the fields you filter on — and the ones your provisioning code never indexes
tags: [lists, columns, provisioning, throttling, list-view-threshold, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-08-15
---

# Indexing built-in fields: the throttle you only meet in production

> **Bottom line.** Provisioning code indexes the columns it creates. `Title` and `Created` are created by SharePoint, so they are usually absent from that list — yet they are exactly what `$filter=Title eq …` and `$orderby=Created desc` hit. Past 5,000 items those reads start throttling, and code that swallows the error keeps running with an empty result. Index built-in fields explicitly, and give any growing list a retention job as well.
>
> **Ve zkratce.** Provisioning indexuje sloupce, které sám zakládá. `Title` a `Created` zakládá SharePoint, takže v tom seznamu obvykle nejsou – a přitom právě na ně míří `$filter=Title eq …` a `$orderby=Created desc`. Nad 5 000 položkami taková čtení začnou throttlovat a kód, který chybu spolkne, běží dál s prázdným výsledkem. Vestavěná pole indexuj výslovně a rostoucímu seznamu dej i retenci.

## Symptom

A per-user-per-day counter list works for a year and then quietly stops counting. Nothing crashes, nothing is logged, the UI shows zeros.

The chain, once the list passes the 5,000-item list view threshold:

1. The write path first **reads** today's row: `?$filter=Title eq '<user>_<day>'`.
2. `Title` is not indexed → SharePoint answers `SPQueryThrottledException`.
3. The code does `if (!r.ok) return;` — a perfectly ordinary guard — so it returns **before the POST**.
4. Nothing is ever written again.

The same shape kills the cleanup job that was supposed to keep the list small: it filters on `Created lt datetime'…'`, also unindexed, so it throttles too and the list can never shrink again. The failure is one-way.

## Cause

Two separate blind spots that reinforce each other:

- **Declared ≠ used.** When you audit "what should be indexed", you naturally walk the column definitions in your provisioning manifest. Built-in fields are not there — nobody wrote them — so they never enter the review, even though they are the most filtered fields in the whole schema.
- **`Indexed: true` cannot be set when the field is created.** SharePoint returns HTTP 500 for that, so indexing has to be a separate step after the field exists. Code that only knows how to set flags at creation time has no place to put it.

## Fix

Declare built-in fields for indexing at the **list** level, not the column level, and apply them in the same post-creation step you already use for your own columns:

```ts
{
  internalName: 'MyGrowingList',
  columns: [ /* … */ ],
  // Built-ins are not in `columns` — SharePoint creates them — but they are
  // exactly what we filter and sort on.
  indexedFields: ['Title', 'Created']
}
```

The step itself, for any field:

```ts
const fieldUrl = `${listEntityUrl}/fields/getbyinternalnameortitle('${name}')`;

// 1) Read the real state. Only write when it is actually missing — this keeps the
//    step idempotent and stops it from throwing 403 noise for ordinary members.
const read = await sp.get(`${fieldUrl}?$select=Indexed`, config, { headers: JSON_HEADERS });
if (!read.ok) { /* unverified — report, do not assume */ return; }
if ((await read.json()).Indexed === true) return;

// 2) MERGE only the difference. Success is 204 No Content.
await sp.post(fieldUrl, config, {
  headers: { ...JSON_HEADERS, 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
  body: JSON.stringify({ Indexed: true })
});
```

Notes that cost time to learn:

- **Do not branch on the read's status code.** A missing field answers `400`, not `404`, and that is indistinguishable from a `403` for a user without rights. Both mean "unverified" — report it and let the next admin run re-settle it.
- **Failure must not break provisioning.** Warn with the real HTTP status and carry on. A user who cannot index a field can still use the app.
- **SharePoint caps indexed columns per list** (20 at the time of writing). Warn when the manifest asks for more instead of letting the writes fail one by one.
- **Some types cannot be indexed at all** — `MultilineText`, `URL`, multi-value person. Skip them with one loud warning; retrying forever is worse than saying it once.

## Retention is the other half

An index moves the threshold further away; it does not remove it. Any list that gains a row per user per day needs a cleanup path too — and that cleanup must itself filter on an indexed field, or it becomes the first thing to break.

## Verify it, before and after

The check that actually proves something is A/B on a live site:

```ts
const r = await fetch(
  `${web}/_api/web/GetList('${serverRelativeListUrl}')` +
  `/fields/getbyinternalnameortitle('Title')?$select=Indexed`,
  { headers: { Accept: 'application/json;odata=nometadata' }, credentials: 'same-origin' }
);
(await r.json()).Indexed;   // false before, true after
```

Include a **control**: a field that was already indexed before your change. Without a "before" reading you cannot tell whether your fix did anything or merely described the existing state.

## Related

- Setting `Indexed: true` while creating a field returns HTTP 500 — index as a separate step.
- Silent `return` on a failed read is far more dangerous in a *write* path than in a read path: it does not mean "nothing loaded", it means "nothing will be saved".
