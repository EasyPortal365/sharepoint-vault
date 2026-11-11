---
title: "Retrying a write without the \"new\" columns on any 400 silently loses data — drop only the column the error names"
short-title: Retrying without new columns on any 400 loses data
summary: When one new column is missing, a group-wide retry drops the ones that exist too; drop only the field the error names as not existing, one at a time, and tell the user what was left out
tags: [rest-api, lists, error-handling, provisioning]
applies-to: SharePoint Online REST
last-reviewed: 2026-11-11
---

# Retrying a write without the "new" columns on any 400 silently loses data — drop only the column the error names

> **Bottom line.** A common guard for columns that a newer release adds (and provisioning may not have created yet) is "on 400, retry the write without the new fields". When only ONE of those columns is missing, the retry drops all of them, the columns that do exist lose the values the user just entered, and the save reports success. Drop only a field the error names **as not existing**, one at a time, and return the list of dropped fields so the UI can say "saved, but without …". Do the same for reads: narrow `$select` by the named field only, never by the whole group.
>
> **Ve zkratce.** Častá pojistka pro sloupce, které přidala novější verze (a provisioning je možná ještě nezaložil), zní „na 400 zopakuj zápis bez nových polí“. Když chybí jen JEDEN z nich, opakování zahodí všechny – sloupce, které na webu jsou, přijdou o právě zadané hodnoty a uložení ohlásí úspěch. Vynech jen pole, které chyba jmenuje **jako neexistující**, po jednom, a vrať seznam vynechaných polí, ať UI řekne „uloženo, ale bez …“. Stejně u čtení: `$select` zužuj jen o jmenované pole, nikdy o celou skupinu.

## Symptom

Users report that some fields "do not save" on one site while the same form works on another. The save returns success; the newer fields simply keep their old values. On a read, values that are stored in existing columns do not show up, the form starts empty, and the next save overwrites them with nothing.

The code had something like this:

```ts
try {
  await merge(itemUrl, body);
} catch (e) {
  if (status(e) !== 400) throw e;
  // "the new columns may not exist yet"
  const { Group, Description, Checklist, ...rest } = body;
  await merge(itemUrl, rest);          // reports success
}
```

## Cause

A write to a column that does not exist fails as a whole with a 400 that names a missing column (see the related article below). The group-wide retry treats that as "none of the new columns exist", although only one is missing:

| Error text (`odata.error.message.value`) | Meaning |
|---|---|
| `The property 'X' does not exist on type 'SP.Data.…ListItem'.` (write) | column X is missing — the others in the group may exist |
| `The field or property 'X' does not exist.` (`$select`) | the same for a read |

It also retries on every other 400, which says nothing about the new columns at all. Keep the retry tied to what the error actually says.

Bad values mostly do not reach this branch: on item writes, a too-long Text value is an HTTP 500, a Choice column takes any string, and `NaN` arrives as `null` with a 204 — each has its own article. A localized wording of the missing-column message was not measured; the `exist` test below simply lets an unrecognized wording propagate.

## Fix

Retry only when the error names a candidate field **as not existing** — whole word, and the message contains "exist" — remove that field alone, and loop. Every other error propagates unchanged.

```ts
function fieldsNamedAsMissing(e: unknown, candidates: string[]): string[] {
  if (status(e) !== 400) return [];
  const msg = sharePointMessage(e);               // NOT your helper's whole message — see Notes
  if (!/exist/i.test(msg)) return [];             // not a missing-column error
  return candidates.filter(f => new RegExp('(^|[^A-Za-z0-9_])' + f + '($|[^A-Za-z0-9_])').test(msg));
}

// Only what SharePoint said: odata.error.message.value from the response body.
function sharePointMessage(e: unknown): string {
  const body = responseBodyOf(e);                 // however your helper keeps the body
  const m = /"value"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  return m ? m[1] : body;
}

async function writeWithoutMissing<T>(body: Record<string, unknown>, late: string[],
  write: (b: Record<string, unknown>) => Promise<T>): Promise<{ result: T; dropped: string[] }> {
  const cur = { ...body };
  const dropped: string[] = [];
  for (;;) {
    try { return { result: await write(cur), dropped }; }
    catch (e) {
      const named = fieldsNamedAsMissing(e, late.filter(f => f in cur));
      if (!named.length) throw e;                  // 403, network, "too long", a core field…
      named.forEach(f => { delete cur[f]; dropped.push(f); });
    }
  }
}
```

The caller shows the result honestly: *"Saved, but without the description – the list does not have this column yet."* For reads, apply the same loop to the `$select` list.

The candidate field names are your own constants, so building a `RegExp` from them is safe; if names can come from elsewhere, use a plain whole-word `indexOf` instead.

## Notes

- **Search SharePoint's text, not your error message.** A helper that throws `GET <url>: HTTP 400 – <body>` (ours does) puts the request URL in the message, and the URL of a read carries the whole `$select`. Searching the full message then "finds" every selected field, and the read drops the whole group again. This one slipped past unit tests that used a body-only error; a test with the real message shape caught it.
- **Whole word matters.** With columns `Party` and `PartyContact`, a plain `indexOf('Party')` matches both.
- **The error body may be truncated** by your HTTP helper (ours keeps the first 200 characters). The sentence fits with room to spare for normal internal names; if it does not, the error propagates — the safe direction.
- **A missing-column 400 means nothing was written** (the whole write fails), so retrying is safe for creates too. Never retry transient errors (429, 503, network) blindly on a create — the first attempt may have succeeded and you get a duplicate.
- **Read the version history first** (`/items(N)/versions`): it shows which fields a save really changed. In the case behind this article it also showed saves that changed nothing at all — that was a different bug in the form, so check before you blame the columns.
- A missing column is always a loud 400 on every write path — see [`AddValidateUpdateItemUsingPath` answers 200 when it creates nothing](validate-endpoint-answers-200-when-nothing-was-written.md). Bad values behave differently: ["Invalid text value" is a MaxLength 500](invalid-text-value-is-a-maxlength-500.md), [Choice fields accept any value](choice-fields-accept-any-value.md), [A decimal comma erases a Number column](decimal-comma-erases-a-number-column.md). Related: [Silent fallbacks poison destructive writes](silent-fallbacks-poison-destructive-writes.md).
