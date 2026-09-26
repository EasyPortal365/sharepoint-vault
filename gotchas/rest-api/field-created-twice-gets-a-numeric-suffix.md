---
title: A column called MyField0 appears — a throttled existence check or two web parts provisioning at once
short-title: A column called `MyField0` appears
summary: "`POST /fields` with a taken name succeeds with a numeric suffix; 429 read as \"missing\", a cached check or two concurrent web parts each make a twin — three-state check, single run per site, name check after the create"
tags: [rest-api, fields, provisioning, throttling, concurrency]
applies-to: SharePoint Online (REST `POST /fields`, any client-side provisioning code, SPFx included)
last-reviewed: 2026-09-26
---

# A column called `MyField0` appears: a throttled existence check or two web parts provisioning at once

> **Bottom line.** `POST /fields` with a name that is already taken does not fail — SharePoint creates a second column and appends a digit to its internal name. The existence check before the POST is your only guard, so it needs three answers: 200 = exists, 400/404 = missing, anything else = unknown — and unknown must not create. Run the setup once per site per page, and compare the `InternalName` in the create response with the one you asked for.
>
> **Ve zkratce.** `POST /fields` s obsazeným jménem neselže – SharePoint založí druhý sloupec a k internímu jménu přidá číslici. Jedinou pojistkou je kontrola existence před `POST`, a ta potřebuje tři odpovědi: 200 = je, 400/404 = není, cokoli jiného = nevím – a „nevím“ nesmí zakládat. Přípravu pouštěj jednou na web a stránku a `InternalName` z odpovědi porovnej s tím, o který jsi žádal.

## Symptom

The Site Pages library grew a second set of columns: `TargetRole0`, `PublishFrom0`, `PublishTo0`, `Translations0`. No error anywhere, no failed request in the console. The app keeps reading and writing the columns without the suffix; the suffixed twins sit next to them, and nobody knows whether they hold data.

## Cause

`POST /_api/web/lists(...)/fields` with a `Title` that is already in use succeeds and creates a duplicate with a numeric suffix on the internal name. The check before the POST is the only thing between you and a duplicate — and there were three ways it said "missing" for a column that existed:

1. **"Unknown" was read as "missing".** The check was `if (check.ok) skip; else create`. A missing field makes `getbyinternalnameortitle` answer 400 rather than 404 ([details](getbyinternalnameortitle-400-not-404.md)), so "not OK means missing" looked right — but 429, 503 and a dropped connection are not OK either. One throttled check, one duplicate.
2. **The browser cache answered the check** with a response from before the column existed ([read-after-write checks and the cache](browser-cache-answers-your-read-after-write-check.md)).
3. **Concurrency.** Several web parts of the same app sat on one page, and each ran the column setup when it mounted. Both checks finished before the first POST did; both saw "missing"; both created.

## Fix

Three answers, a second opinion for "unknown", one run per site, and a name check after the create:

```ts
type Presence = 'found' | 'absent' | 'unknown';

// noCache(url) appends a cache-busting query parameter
async function fieldPresence(listUrl: string, name: string): Promise<Presence> {
  const r = await get(noCache(`${listUrl}/fields/getbyinternalnameortitle('${encodeURIComponent(name)}')?$select=InternalName`));
  if (r.ok) return 'found';
  if (r.status === 400 || r.status === 404) return 'absent';
  // 429, 5xx, 403, network: ask a second way before deciding anything
  const q = await get(noCache(`${listUrl}/fields?$select=InternalName&$filter=InternalName eq '${encodeURIComponent(name)}'`));
  if (!q.ok) return 'unknown';
  const rows: { InternalName: string }[] = (await q.json()).value;
  return rows.some(f => f.InternalName === name) ? 'found' : 'absent';
}

const inflight: { [site: string]: Promise<void> | undefined } = {};

export function ensureFields(siteUrl: string): Promise<void> {
  const key = siteUrl.toLowerCase().replace(/\/+$/, '');
  const running = inflight[key];
  if (running) return running;                      // a second web part gets the same run
  const clear = (): void => { inflight[key] = undefined; };
  const p = runSetup(siteUrl).then(clear, (e) => { clear(); throw e; });
  inflight[key] = p;
  return p;
}

// inside runSetup(): create only on 'absent' ('unknown' = try again next load), then check the name
const created: string = (await res.json()).InternalName;
if (created !== name) console.error(`Duplicate column: asked for ${name}, SharePoint created ${created}`);
```

- **"Unknown" means "try again next time", never "create".** A column missing until the next page load is cheap; a duplicate is permanent.
- **The single-flight map covers one page only.** Two browsers in the same second can still race — SharePoint documents no lock you could hold around a field creation — which is why the name check after the create matters.
- **When the name does not match, log it loudly and delete nothing.** The twin may already hold data; cleaning up is an administrator's decision.

## Notes

- Give the test a counterexample that can fail: a fake SharePoint that really appends `0` on a blind POST, so "create without checking" produces `MyField0` — then assert that a throttled check, an unanswered second check and two concurrent runs each create nothing extra.
- Creating the field from schema XML with a fixed field `Id` might also stop the cross-browser race; that has not been verified live.
