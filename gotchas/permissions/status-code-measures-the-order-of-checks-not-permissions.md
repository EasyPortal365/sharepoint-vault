---
title: A status code measures where the request stopped first, not what the user may do
tags: [permissions, rest-api, testing, security]
applies-to: SharePoint Online
last-reviewed: 2026-09-06
---

# A status code measures the order of checks, not permissions

> **Bottom line.** A clever non-destructive permission probe — send a write with a deliberately stale `IF-MATCH` etag and read permissions off the status code, `403` meaning "denied" and `412` meaning "you would have been allowed" — is wrong. SharePoint evaluates the **etag before the permission check**, so `412` comes back even for lists where the same account has no `EditListItems` at all. The probe measures which gate the request hit first, not what the caller may do. `EffectiveBasePermissions` answers the actual question and cannot be misread.
>
> **Ve zkratce.** Chytrý nedestruktivní test oprávnění – poslat zápis se záměrně zastaralým etagem v `IF-MATCH` a z návratového kódu usoudit na práva, kde `403` znamená „nesmíš“ a `412` „směl bys“ – je špatně. SharePoint vyhodnotí etag dřív než oprávnění, takže `412` přijde i u seznamů, kde tentýž účet nemá `EditListItems` vůbec. Test měří, na které bráně se požadavek zastavil jako první, ne co volající smí. Na tu otázku odpovídá `EffectiveBasePermissions` a vyložit se špatně nedá.

## Symptom

You want to verify that item-level or list-level hardening really keeps an ordinary member out of records they did not create — and you want to verify it **without writing anything**, because a write would stamp `Modified` and `Editor` and destroy the very tamper evidence the hardening exists to protect.

So you send a `MERGE` at someone else's item with `IF-MATCH: "0"` and read the status:

```js
const r = await fetch(listBase + '/items(' + otherId + ')', {
  method: 'POST', credentials: 'include',
  headers: {
    'X-RequestDigest': digest,
    'X-HTTP-Method': 'MERGE',
    'IF-MATCH': '"0"',                 // guaranteed stale
    'Content-Type': 'application/json;odata=nometadata'
  },
  body: JSON.stringify({ Title: 'probe' })
});
// assumed: 403 = denied, 412 = allowed-but-stale
```

Every list comes back `412`. Read literally, that says the member could overwrite every record on the site.

## Cause

The assumption "permissions are checked before the etag" was never verified — it just sounded reasonable. It is false. The precondition is evaluated first, so a stale `IF-MATCH` short-circuits the request **before** authorisation is reached, and `412` tells you nothing about rights.

Measured on a real tenant under an ordinary member account: seven lists on one site, all seven `412` — while the same run read `EffectiveBasePermissions` and found `EditListItems = false` on five of them. Two independent numbers in the same output contradicted each other, which is the only reason the mistake surfaced at all.

## What to do instead

Ask the server the question directly. `EffectiveBasePermissions` is computed for the current user and needs no interpretation:

```js
const r = await fetch(listBase + '/EffectiveBasePermissions', {
  credentials: 'include', headers: { Accept: 'application/json;odata=nometadata' }
});
const { Low } = await r.json();          // string or number, 32 low bits
const EDIT = 0x00000004;                 // EditListItems
const DEL  = 0x00000008;                 // DeleteListItems
const ML   = 0x00000800;                 // ManageLists
const may = bit => (Number(Low) & bit) === bit;
```

`ManageLists` is the bit that decides whether item-level settings mean anything at all: an account holding it can edit the list schema and reach records that `ReadSecurity`/`WriteSecurity` were supposed to hide.

Two further points, both learned the same afternoon:

- **Run the probe under an ordinary account.** A site collection administrator holds `ManageLists` everywhere, so the probe comes back green even when nothing is hardened — a false green in exactly the place the probe exists to examine.
- **Print the inputs, not just the verdict.** The faulty inference was caught only because the same table showed `Edit = no` next to "would be allowed to write". A probe that prints a conclusion alone is a probe you cannot audit.

## Why the trick is tempting

The instinct behind it is sound: a genuine write test is destructive, and on lists that carry audit trails the write itself damages what you are inspecting. The error is not wanting a non-destructive probe — it is building one on an unverified belief about server internals and then trusting its output. When a measurement exists because direct measurement is unsafe, its own assumption needs a check too.
