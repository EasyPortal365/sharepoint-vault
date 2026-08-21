---
title: getUserEffectivePermissions returns a 64-bit mask — decode it wrong by one bit and every user looks locked out
tags: [permissions, rest-api, diagnostics, base-permissions]
applies-to: SharePoint Online, SharePoint 2016+
last-reviewed: 2026-08-21
---

# Decoding `BasePermissions` off by one turns "Read" into "no access"

> **Bottom line.** `getUserEffectivePermissions` answers with `{ "Low": "138612833", "High": "176" }` — two decimal strings holding one 64-bit mask. `ViewListItems` is **bit 0**, not bit 1. Shift the whole mask by one and a perfectly normal *Read* grant reads back as "this user cannot even open the list", which looks exactly like a broken permission fix.
>
> **Ve zkratce.** Maska je 64bitová ve dvou dekadických řetězcích a `ViewListItems` je **bit 0**. Posun o jeden bit udělá z běžného *Čtení* falešný nález „uživatel nemá ani čtení".

## Symptom

You verify a permission change without signing in as the affected user — the right way, since you should never handle someone else's password:

```
GET /_api/web/GetList('/sites/x/Lists/Config')/getUserEffectivePermissions(@u)
    ?@u='i:0%23.f|membership|user@contoso.com'
```

Your decoder says `view=false, add=false, edit=false` for every ordinary member, while the site administrator comes back with everything `true`. The obvious reading — "the members lost access, the permission script broke something" — is wrong, and the administrator row is what should make you suspicious: an admin is `true` for *any* decoding error, because their mask has nearly every bit set.

Reading the list's own `roleassignments` then contradicts the decoder: the members group really does hold *Read*.

## Cause

`BasePermissions` is a 64-bit flags value serialised as two unsigned 32-bit decimal **strings**. The enum starts at bit 0:

| Bit | Value | Permission |
|---|---|---|
| 0 | `0x1` | ViewListItems |
| 1 | `0x2` | AddListItems |
| 2 | `0x4` | EditListItems |
| 3 | `0x8` | DeleteListItems |
| 4 | `0x10` | ViewVersions |
| 11 | `0x800` | ManageLists |
| 12 | `0x1000` | ViewFormPages |

Counting the permissions as "the first one, the second one…" and starting at 1 shifts everything: `ViewListItems` gets tested against `AddListItems`, so a Read-only user reports as having nothing.

Two smaller traps in the same call:

- **`Low` can exceed 2³¹.** `parseInt(j.Low, 10)` then produces a number whose bit 31 is the sign bit in JavaScript's 32-bit bitwise operators. Normalise with `>>> 0` and shift with `>>>`, never `>>`.
- **The values are strings**, not numbers — JSON keeps them as `"138612833"` precisely because a 64-bit integer does not survive as a JS number.

Reference masks worth memorising, because they let you sanity-check a decoder instantly:

| Role | Low | High |
|---|---|---|
| Read | 138612833 | 176 |
| Full Control (or any site collection admin) | 4294705151 | 2147483647 |

## Fix

```js
// Low/High are decimal STRINGS holding one 64-bit mask; bit 0 = ViewListItems.
function decodeBasePermissions(bp) {
  const low = Number(bp.Low) >>> 0;
  const high = Number(bp.High) >>> 0;
  const has = (bit) => (bit < 32 ? (low >>> bit) & 1 : (high >>> (bit - 32)) & 1) === 1;
  return {
    view: has(0), add: has(1), edit: has(2), del: has(3),
    manageLists: has(11),
  };
}
```

Verify the decoder before you trust a finding: run it against a **site collection administrator** (must be all-true) *and* against a user you know holds plain Read (must be view-only). One row alone proves nothing — the admin row is true even when the code is wrong, and the member row is false for both "no access" and "off by one".

## Notes

- Cross-check anything alarming against the list's `roleassignments?$expand=Member,RoleDefinitionBindings`. When the two disagree, the decoder is the more likely suspect: role assignments are plain text, masks are arithmetic.
- `getUserEffectivePermissions` is the honest way to answer "what can *they* do?" without borrowing an account. It resolves group membership for you, including claims groups such as *Everyone except external users*.
- A site collection administrator always returns Full Control regardless of the list's own grants, so they can never be your test subject for a restriction.
- It answers about *list-level* rights. Item-level read/write settings (`ReadSecurity` / `WriteSecurity` = 2) are **not** reflected in this mask, and a member holding `ManageLists` bypasses them entirely.
