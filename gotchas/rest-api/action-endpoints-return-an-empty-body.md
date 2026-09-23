---
title: moveto succeeds and your code reports a failure — action endpoints return an empty body
tags: [rest-api, files, groups, error-handling]
applies-to: SharePoint Online
last-reviewed: 2026-09-24
---

# `moveto` succeeds and your code reports a failure — action endpoints return an empty body

> **Bottom line.** Several SharePoint REST actions answer success with an **empty body** — `moveto` on a file and `removebyid` on a group's users among them. A shared helper that always ends in `response.json()` throws *after* the operation has happened, and the UI reports a failure that the user will "fix" by trying again. Decide by the status code, and parse a body only where you actually read something from it.
>
> **Ve zkratce.** Řada akcí SharePoint REST ohlásí úspěch s **prázdným tělem** – mimo jiné `moveto` u souboru a `removebyid` u uživatelů skupiny. Sdílený helper, který vždy končí `response.json()`, spadne až *po* provedení operace a UI ohlásí chybu, kterou uživatel „opraví“ opakováním. Rozhoduj podle status kódu a tělo parsuj jen tam, kde z něj opravdu něco čteš.

## Symptom

A file move completes in SharePoint, and the dialog says:

```
Not moved: Failed to execute 'json' on 'Response': Unexpected end of JSON input
```

The user tries again — on a file that is no longer at the source path. Removing a member from a SharePoint group goes the same way: the member is gone, the panel shows an error and does not refresh, and the admin clicks a row that no longer exists.

## Cause

```ts
async function post(url: string, body?: unknown): Promise<any> {
  const r = await client.post(url, cfg, { body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();            // ← throws on an empty body, after a successful operation
}
```

`…/getfilebyserverrelativeurl('…')/moveto(newurl='…',flags=0)` and `…/sitegroups(<id>)/users/removebyid(<id>)` return nothing to parse. The helper was written for calls that return an entity and then reused for calls that do not.

## Fix

Two helpers, chosen by whether the caller reads the result:

```ts
/** Actions: success is the status code. */
async function postVoid(url: string, body?: unknown): Promise<void> {
  const r = await client.post(url, cfg, body === undefined ? {} : { body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

/** Calls that return an entity you actually use. */
async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await client.post(url, cfg, body === undefined ? {} : { body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const text = await r.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
```

## Notes

- **A failure after the operation is worse than a failure before it.** It invites a retry of something that already happened. For every write, ask what the user sees when only the parsing of the response fails.
- The retry is not harmless either: the source is gone, so a second `moveto` answers 404 and reads like a real error. [Batch file move: group by file, not by record](batch-file-move-group-by-file-not-record.md) shows how a rerun can adopt a file that is already at the destination.
