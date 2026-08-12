---
title: createfieldasxml ignores Name/StaticName — the internal name is derived from DisplayName
tags: [lists, columns, rest-api, provisioning, formatting]
applies-to: SharePoint Online
last-reviewed: 2026-08-13
---

# Column internal names: SharePoint derives them from the label, whatever your XML says

> **Bottom line.** Adding a field to a **list** with `createfieldasxml` ignores `Name` and `StaticName` in your schema XML and builds the internal name from `DisplayName` — so a localized label leaves you with `_x00da_tvar` forever. Create the field with an ASCII `DisplayName`, then rename its `Title`: the internal name is fixed at creation, the label is not.
>
> **Ve zkratce.** Když přidáváš pole do **seznamu** přes `createfieldasxml`, SharePoint `Name` ani `StaticName` ze schématu nepoužije a interní název odvodí z `DisplayName` – z lokalizovaného popisku ti tak napořád zůstane `_x00da_tvar`. Zakládej s ASCII `DisplayName` a hezký `Title` nastav až potom: interní název je dán okamžikem vzniku, popisek ne.

## Symptom

You create columns with explicit internal names:

```xml
<Field Type='Choice' Name='Utvar' StaticName='Utvar' DisplayName='Útvar' Format='Dropdown'>…</Field>
```

The call returns `200`, and the response says `InternalName: "_x00da_tvar"`. Same for
`Typ dokumentu` → `Typ_x0020_dokumentu`. Every formatter, CAML query and `$select` you write
afterwards has to carry those escapes.

## Cause

`Name`/`StaticName` are honoured for **site columns** (`/_api/web/fields`), but when a field
is added to a list, SharePoint generates the internal name from the display name, percent-
escaping anything outside `A–Z a–z 0–9` as `_x00xx_` (`Ú` → `_x00da_`, space → `_x0020_`).
It is the same rule that gives a list its URL from its title — and it is equally permanent:
renaming the column later changes only the label.

## Fix

Create with an ASCII display name, then set the real one:

```js
// 1) create — DisplayName decides the internal name
const r = await sp.post(`${web}/_api/web/GetList('${listRel}')/fields/createfieldasxml`, {
  parameters: { SchemaXml: "<Field Type='Choice' DisplayName='Utvar' Format='Dropdown'>…</Field>", Options: 0 }
});
const internal = (await r.json()).InternalName;      // "Utvar"

// 2) rename — label only, internal name stays clean
await sp.post(`${web}/_api/web/GetList('${listRel}')/fields/getbyinternalnameortitle('${internal}')`,
  { headers: { 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' }, body: JSON.stringify({ Title: 'Útvar' }) });
```

## Why it is worth the extra call

Internal names are what everything else refers to: `[$Utvar]` in view formatting, `$select`,
CAML `<FieldRef Name>`, Search managed-property mappings, PnP templates. `[$_x00da_tvar]`
works, but every future author has to know why it looks like that — and escapes are easy to
mistype in JSON where you get no error, just a silently empty column.

## Rule

Anything whose **URL or internal name is generated from a label** — lists, columns, content
types — should be created under an ASCII name and renamed afterwards. Decide the machine
name at creation, because that is the only moment you control it.
