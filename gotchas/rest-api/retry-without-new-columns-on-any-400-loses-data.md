---
title: "Retrying a write without the \"new\" columns on any 400 silently loses data — drop only the column the error names"
short-title: Retrying without new columns on any 400 loses data
summary: A 400 is not always a missing column; drop only the field the error names as not existing, one at a time, and tell the user what was left out
tags: [rest-api, lists, error-handling, provisioning]
applies-to: SharePoint Online REST
last-reviewed: 2026-11-11
---

# Retrying a write without the "new" columns on any 400 silently loses data — drop only the column the error names

> **Bottom line.** A common guard for columns that a newer release adds (and provisioning may not have created yet) is "on 400, retry the write without the new fields". A 400 also means *value too long* or *invalid choice*, so that retry throws away good data and reports success. Drop only a field the error names **as not existing**, one at a time, and return the list of dropped fields so the UI can say "saved, but without …". Do the same for reads: narrow `$select` by the named field only, never by the whole group.
>
> **Ve zkratce.** Častá pojistka pro sloupce, které přidala novější verze (a provisioning je možná ještě nezaložil), zní „na 400 zopakuj zápis bez nových polí“. Jenže 400 znamená i *příliš dlouhou hodnotu* nebo *neplatnou volbu* – a pak opakování zahodí platná data a ohlásí úspěch. Vynech jen pole, které chyba jmenuje **jako neexistující**, po jednom, a vrať seznam vynechaných polí, ať UI řekne „uloženo, ale bez …“. Stejně u čtení: `$select` zužuj jen o jmenované pole, nikdy o celou skupinu.

## Symptom

Users report that a field "does not save". The item's version history shows new versions in which **no field changed** — the save went through, the field just was not in the body. Or the field saves on one site and silently disappears on another.

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

SharePoint answers 400 for many reasons, and some of them name the very field you were about to drop:

| Error text (`odata.error.message.value`) | Column exists? |
|---|---|
| `The property 'X' does not exist on type 'SP.Data.…ListItem'.` (write) | no |
| `The field or property 'X' does not exist.` (`$select`) | no |
| `Sloupec X neexistuje.` and other localized forms | no |
| `The value of field X exceeds the maximum length.` | **yes** |
| an invalid choice, a malformed number, a bad lookup id | **yes** |

A group-wide retry on any 400 therefore drops a field that exists and holds valid data. A group-wide narrowing of `$select` on a read is worse: the existing values are not shown, the form starts empty, and the next save overwrites them with nothing.

## Fix

Retry only when the error names a candidate field **as not existing** — whole word, and the message contains "exist" — remove that field alone, and loop. Every other error propagates unchanged.

```ts
function fieldsNamedAsMissing(e: unknown, candidates: string[]): string[] {
  if (status(e) !== 400) return [];
  const msg = sharePointMessage(e);               // NOT your helper's whole message — see Notes
  if (!/exist/i.test(msg)) return [];             // "exceeds the maximum length" names X too
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

- **Search SharePoint's text, not your error message.** Many helpers throw `GET <url>: HTTP 400 – <body>`, and the URL of a read carries the whole `$select`. Searching the full message then "finds" every selected field, and the read drops the whole group again. This one slipped past unit tests that used a body-only error; a test with the real message shape caught it.
- **Whole word matters.** With columns `Party` and `PartyContact`, a plain `indexOf('Party')` matches both.
- **The error body may be truncated** by your HTTP helper (many keep only the first 200 characters). The sentence fits with room to spare for normal internal names; if it does not, the error propagates — the safe direction.
- **A 400 means nothing was written**, so retrying is safe for creates too. Never retry transient errors (429, 503, network) blindly on a create — the first attempt may have succeeded and you get a duplicate.
- **Find the cause from the version history** (`/items(N)/versions`): a new version without any field change points at the request body built on the client, not at SharePoint.
- A missing column is always a loud 400 on every write path — see [`AddValidateUpdateItemUsingPath` answers 200 when it creates nothing](validate-endpoint-answers-200-when-nothing-was-written.md). Related: [Silent fallbacks poison destructive writes](silent-fallbacks-poison-destructive-writes.md).
