---
title: PermissionKind is 1-based — decoding BasePermissions with `1 << kind` invents a security finding
tags: [permissions, rest-api, security, csom]
applies-to: SharePoint Online
last-reviewed: 2026-09-04
---

# `1 << kind` is off by one, and it lands on `ManageLists`

> **Bottom line.** `BasePermissions` is a bit mask, but `PermissionKind` is **1-based**: the flag for kind *k* is `1 << (k - 1)`. Decode it with `1 << k` and every permission shifts by one place — so a role that merely has `ViewFormPages` reports as having `ManageLists`, and a correctly hardened list looks wide open.
>
> **Ve zkratce.** `PermissionKind` je 1-based, bit je `1 << (kind − 1)`. S `1 << kind` se všechna oprávnění posunou o jedno a role, která má jen `ViewFormPages`, se ohlásí jako by měla `ManageLists` — správně zpevněný seznam pak vypadá jako díra.

## Symptom

You write a quick console check to confirm a hardened list really restricts ordinary members, and it tells you the opposite: the *Members* group — and even *Visitors* — appear to hold `ManageLists`, which would bypass item-level `ReadSecurity` entirely.

The give-away that something is wrong with the *measurement* rather than the tenant: the decoded set is subtly implausible. Built-in **Contribute** comes back with `ManageLists` but **without** `DeleteListItems` — a combination no built-in level has. When a decode produces a role that does not exist in SharePoint, suspect the decoder.

## Cause

```ts
// WRONG — off by one for every permission
const has = (low: string, kind: number) => !!(Number(low) & (1 << kind));
```

`SPBasePermissions` is a flags enum whose values are `1 << (kind - 1)`:

| PermissionKind | value | bit |
|---|---|---|
| `ViewListItems` = 1 | `0x1` | 0 |
| `AddListItems` = 2 | `0x2` | 1 |
| `EditListItems` = 3 | `0x4` | 2 |
| `DeleteListItems` = 4 | `0x8` | 3 |
| … | | |
| `ManageLists` = 12 | `0x800` | 11 |
| `ViewFormPages` = 13 | `0x1000` | 12 |

So `1 << 12` reads the `ViewFormPages` bit while you believe you are reading `ManageLists`. Contribute has `ViewFormPages`; it does not have `ManageLists` — hence the false alarm. The client-side CSOM helper gets this right (`var num = perm - 1;`), which is why the bug only appears in hand-rolled REST decoders.

## What to do

```ts
const has = (bp: { High: string; Low: string }, kind: number) => {
  const n = kind - 1;                                  // 1-based → bit index
  return n < 32
    ? (Number(bp.Low)  & (1 << n)) !== 0
    : (Number(bp.High) & (1 << (n - 32))) !== 0;
};
```

- **Calibrate the decoder against a known level before trusting it.** Read the web's `roledefinitions` (`Name`, `RoleTypeKind`, `BasePermissions`) and decode *Read*, *Contribute*, *Edit* and *Full Control*. If Contribute does not come out as exactly `ViewListItems, AddListItems, EditListItems, DeleteListItems, OpenItems, ViewVersions, DeleteVersions, ManagePersonalViews, ViewFormPages`, your decoder is wrong — not the tenant.
- **Compare `RoleTypeKind`, not the display name.** A level called "Contribute" can be a custom definition; `RoleTypeKind` 2 = Read, 3 = Contribute, 6 = Edit, 5 = Full Control. Name is a label, type is the fact.
- **Mind `Number()` on the 64-bit mask.** `Low` and `High` arrive as strings. Bits above 31 belong to `High`, and JavaScript bitwise operators are 32-bit — never `Number(Low) & (1 << 40)`.
- **The permission that actually matters for item-level protection is `ManageLists`.** `ReadSecurity: 2` / `WriteSecurity: 2` only bind users who lack it, so *Edit* (which has it) defeats them and *Contribute* (which does not) respects them. That single bit is usually the whole question — get its position right.

## Notes

- Why this matters more than an ordinary bug: the failure direction is toward a **false positive**. You end up reporting a vulnerability that is not there, and if anyone "fixes" it, they will loosen or churn a configuration that was already correct.
- A site collection administrator and the site *Owners* group bypass list ACLs regardless, so checking effective permissions while signed in as either proves nothing about ordinary users. Read the list's `roleassignments` instead — that is a property of the list, not of whoever is asking.
- A `403` on `EffectiveBasePermissions` usually means no access to the *web* at all; check `/_api/web` first, otherwise you cannot tell "restricted list" from "not a member here".
