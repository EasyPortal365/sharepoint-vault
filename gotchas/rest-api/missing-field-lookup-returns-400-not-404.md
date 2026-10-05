---
title: Looking up a field that does not exist returns 400, not 404
short-title: Missing field lookup = 400, not 404
summary: "`fields/GetByInternalNameOrTitle` on a missing field answers 400; test existence with a `$filter` instead"
tags: [rest-api, fields, provisioning]
applies-to: SharePoint Online
last-reviewed: 2026-10-05
---

# Looking up a field that does not exist returns 400, not 404

> **Bottom line.** `GET …/fields/GetByInternalNameOrTitle('X')` for a field that is not there answers **HTTP 400** (an `SPException` "column does not exist"), not 404 — an idempotent "create the column if missing" check that waits for 404 therefore throws on exactly the case it was written for; check existence with `…/fields?$filter=InternalName eq 'X'` and an empty `value` array.
>
> **Ve zkratce.** `GET …/fields/GetByInternalNameOrTitle('X')` na pole, které neexistuje, vrátí **HTTP 400** (`SPException` „sloupec neexistuje“), ne 404 – idempotentní kontrola „založ, když chybí“ čekající na 404 tak spadne právě v případě, pro který vznikla; existenci zjišťuj přes `…/fields?$filter=InternalName eq 'X'` a prázdné pole `value`.

## Symptom

A setup script meant to add a column only when missing stops with `field check HTTP 400` on its very first run, against a library that has never had the column.

## Cause

Lists and files do answer 404 for a missing path (`GetList('…')`, `GetFolderByServerRelativePath`), which makes 404 the natural expectation. Field lookups by name are different: SharePoint raises an argument-style exception, which the REST layer maps to 400.

## Fix

```js
const r = await fetch(list + "/fields?$select=Id&$filter=InternalName eq 'MeetingDate'", { headers });
if (!r.ok) throw new Error('field check HTTP ' + r.status);   // a real failure
const exists = (await r.json()).value.length > 0;
```

A 400 on the direct lookup cannot be told apart from a genuinely malformed request, so treating "400 = missing" is not a safe shortcut.
