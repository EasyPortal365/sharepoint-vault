---
title: A count over a ReadSecurity 2 list is only the reader's share — and the bit that says "sees everything" is Manage Lists alone
short-title: A count over a ReadSecurity 2 list is only the reader's share
summary: Item-level read security filters rows silently, so a client-side count or ranking is the reader's own rows; show it only with `ReadSecurity = 1` or Manage Lists in the reader's mask, and don't also demand Override List Behaviors — the Edit role (`0x3C431AEF`) lacks it
tags: [permissions, lists, item-level-security, effective-permissions, aggregates]
applies-to: SharePoint Online and Server — any client-side count, sum or ranking computed from a list with item-level read security
last-reviewed: 2026-09-24
---

# A count over a ReadSecurity 2 list is only the reader's share — and the bit that says "sees everything" is Manage Lists alone

> **Bottom line.** On a list with `ReadSecurity = 2` ("read only items the user created"), an ordinary reader gets only their own rows — HTTP 200, no error, nothing in the response saying it is partial. A count or ranking you compute in the browser is therefore the reader's share, not the total. Show the number only when the reader provably sees everything: `ReadSecurity = 1`, or **Manage Lists** in the reader's effective permissions. Don't also demand "Override List Behaviors" (`CancelCheckout`) — the Edit role does not have it, and requiring both hides the number from every ordinary member of a team site.
>
> **Ve zkratce.** Na seznamu s `ReadSecurity = 2` („číst jen vlastní položky“) dostane běžný čtenář jen svoje řádky – HTTP 200, žádná chyba, nic, co by řeklo, že je výsledek neúplný. Počet nebo pořadí spočítané v prohlížeči je tedy podíl čtenáře, ne celek. Číslo ukazuj jen tomu, kdo prokazatelně vidí všechno: `ReadSecurity = 1`, nebo **Spravovat seznamy** v jeho efektivních právech. Nevyžaduj k tomu ještě „Přepsat chování seznamu“ (`CancelCheckout`) – role Úpravy ho nemá a kontrola na oba bity schová číslo všem běžným členům týmového webu.

## Symptom

Per-user rows are the right way to store votes, ratings or acknowledgements: one row per person, readable and writable only by its author (`ReadSecurity = 2`, `WriteSecurity = 2`). Then a feature needs a total — "helped 12 people", "most helpful first" — and computes it from those rows:

- The site owner sees correct totals and a sensible ranking.
- An ordinary member sees 0 or 1 on every item, and "most helpful" sorts by their own clicks.
- No request fails, so nothing in the logs or the UI hints at it.

## Cause

Item-level read security filters the rows per caller, silently. The rows the server returns are exactly the rows the caller may read, and a 200 with a short list looks like a small list.

Two things bypass it: **Manage Lists** (`0x800` in the low half of the permission mask) — measured: members of a modern team site hold Edit, which includes it, and read everything — and, according to its description, **Override List Behaviors** (`CancelCheckout`, `0x100`), which we have not measured.

The trap when you write the check: the built-in levels do not carry these two together.

| Level | Low mask | Manage Lists `0x800` | Override List Behaviors `0x100` |
|---|---|---|---|
| Full Control | `0xFFFFFFFF` | yes | yes |
| Design | `0x3C5F1BFF` | yes | yes |
| **Edit** | `0x3C431AEF` | **yes** | **no** |
| Contribute | `0x3C4312EF` | no | no |
| Read | `0x08431061` | no | no |

(Standard role masks; the Edit value is the one `getusereffectivepermissions` returns for an Edit member — see [Check another user's effective permissions](../../snippets/rest/check-another-users-effective-permissions.md).) A check written as "Manage Lists **and** Override List Behaviors" looks thorough and denies the total to every Edit member — which, on a team site, is nearly everyone.

## Fix

Measure completeness before you claim a number:

```ts
const lit = encodeURIComponent(listUrl.split("'").join("''"));
const info = await get(`${web}/_api/web/GetList(@u)?@u='${lit}'&$select=ReadSecurity,EffectiveBasePermissions`);
const low = Number(info.EffectiveBasePermissions?.Low);
const MANAGE_LISTS = 0x800;
const seesAll = info.ReadSecurity === 1 || (Number.isFinite(low) && (low & MANAGE_LISTS) !== 0);
// unreadable mask → false: show no number rather than a wrong one
```

- `seesAll === false` → don't show the count and disable sorting by it, with a short reason. An absent number is honest; a small one is not.
- Page through to the end and admit truncation: if you stop after N pages, report "incomplete" instead of the partial sum.
- Treat "Override List Behaviors without Manage Lists" (a custom level) as unknown until you have measured it on your tenant.
- In tests, use the real masks of the built-in levels. A fake that gives every user a full mask lets the "both bits" check pass.

## Notes

- `(low & 0x800)` works because `0x800` sits in the low 32 bits; the mask comes back as decimal strings in `Low`/`High` ([Effective permissions come as a bitmask](../security/effective-permissions-bitmask-off-by-one.md)).
- The same partial read makes an administrator "recount" dangerous: rebuilding a stored aggregate from the rows an account can see wipes out everybody else's votes unless that account reads everything — [View counts and ratings written by readers cannot live in a list only editors may write](../lists/reader-written-counters-belong-in-their-own-list.md).
- Why the rows and not a stored counter: [SharePoint REST has no increment](../rest-api/a-counter-written-from-a-stale-read-loses-votes.md).
- Background on the setting itself: [A provisioned list with ReadSecurity=2 looks perfect to an admin and empty to everyone else](../lists/item-level-permissions-defaults-on-provisioned-lists.md).
