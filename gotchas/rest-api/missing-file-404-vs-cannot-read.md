---
title: "\"File is missing\" and \"I cannot read the file\" collapse into the same null — and the empty state then lies"
tags: [rest-api, files, error-handling, permissions, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-26
---

# "File is missing" and "I cannot read the file" collapse into the same null

> **Bottom line.** A per-user JSON file in a library is a legitimate storage pattern — the file path *is* the filter, so everyone physically reads only their own. But a missing file (404) is a normal, meaningful state, while 403/500/network failure is not. If your read helper returns `T | null`, both land on `null`, and a friendly empty state ("Nothing is waiting — you are all done") ends up telling the exact opposite of the truth to the one person who has something overdue.
>
> **Ve zkratce.** Osobní JSON soubor v knihovně je legitimní vzor — cesta k souboru je zároveň filtrem, takže každý fyzicky čte jen svůj. Jenže „soubor neexistuje" (404) je normální stav, kdežto 403/500/výpadek sítě ne. Když čtecí helper vrací `T | null`, obojí skončí jako `null` a vlídný prázdný stav („Nic vás nečeká") pak lže právě tomu, kdo má něco po termínu.

## Symptom

A view reads a per-user JSON file and shows one of two things: the list of pending items, or a positive empty state. In testing it always works. In production, some users see "nothing waiting" while the data clearly says otherwise — and nobody reports it as a bug, because a reassuring screen does not look like a failure.

## Cause

The read helper swallows everything:

```ts
private async json<T>(url: string): Promise<T | null> {
  try {
    const r = await this.sp.get(url, SPHttpClient.configurations.v1, { headers: HDR });
    if (!r.ok) return null;             // 404? 403? 500? — indistinguishable
    return await r.json() as T;
  } catch (e) { return null; }          // network failure — also indistinguishable
}
```

Callers then do `const entries = (doc && doc.documents) || []` and render the empty state. Four different situations produce the same screen:

| Situation | HTTP | What the user should see |
|---|---|---|
| New employee, nothing assigned yet | 404 | "Nothing is waiting" — correct |
| No access to the site holding the library | 403 | An error |
| Server error / throttling | 500 / 429 | An error |
| Network or tenant unreachable | (throw) | An error |

There is a second trap layered on top: libraries that shard per-user files (`<root>/<first-letter>/<upn>.json`) usually keep a legacy flat path (`<root>/<upn>.json`) for older tenants. The read tries both — so "missing" means **404 on every candidate path**, not on the first one.

## Fix

Return the status, not just the payload, and let only one specific status mean "empty":

```ts
interface IReadResult<T> { ok: boolean; status: number; data?: T }

private async read<T>(url: string, accept?: string): Promise<IReadResult<T>> {
  try {
    const r = await this.sp.get(url, SPHttpClient.configurations.v1,
      { headers: accept ? { Accept: accept } : HDR });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, status: r.status, data: await r.json() as T };
  } catch (e) {
    return { ok: false, status: 0 };   // 0 = "don't know" — never "empty"
  }
}
```

```ts
const urls = [rootUrl + '/' + shardOf(upn) + '/' + file, rootUrl + '/' + file];  // sharded, then legacy
let doc: IUserDoc | undefined;
let lastStatus = 0;
for (let i = 0; i < urls.length && !doc; i++) {
  const r = await this.read<IUserDoc>(
    base + "/_api/web/getfilebyserverrelativeurl('" + odataString(urls[i]) + "')/$value",
    'text/plain'
  );
  if (r.ok) { doc = r.data || {}; break; }
  lastStatus = r.status;
}
if (!doc) {
  // 404 on BOTH candidate paths = the user genuinely has no data.
  if (lastStatus !== 404) throw new Error(`Could not read personal data (HTTP ${lastStatus || '—'}).`);
  return EMPTY;
}
```

The UI rule that follows from this: **an error message and an empty state must be mutually exclusive.** If the read threw, render the error — never the reassuring "you are all done".

## Notes

- `odataString()` (escape `'` → `''`) is not optional here: a UPN like `o'brien@contoso.com` ends the OData string literal early and the request comes back as 400, which under a `T | null` helper looks exactly like "no data". Users with an apostrophe in their name would silently never see their items.
- Reading the raw file body needs `Accept: text/plain` on `/$value`, not the JSON accept header you use for list items.
- The same reasoning applies to any *supplementary* read: if read A only enriches the result of read B (names, labels, icons), its failure must degrade the display, not cancel the result — and the UI should admit the gap rather than silently dropping rows.
