---
title: "HasUniqueRoleAssignments proves the break, not the hardening — and a half-done break is worse than inheritance"
tags: [permissions, security, rest-api, provisioning, verification]
applies-to: SharePoint Online, SharePoint Server (list/library/item scope)
last-reviewed: 2026-09-02
---

# `HasUniqueRoleAssignments` proves the break, not the hardening

> **Bottom line.** Hardening a list is three steps — break inheritance, then trim the copied assignments, then verify. `HasUniqueRoleAssignments` flips to `true` after **step one**, so any check that stops there reports "locked" over a list where step two never ran. And because the safe form of the break is `copyRoleAssignments=true`, the half-done state is **worse than plain inheritance**: the copy hands the object its own private grant of Members-with-Edit, which carries `ManageLists` and therefore ignores `ReadSecurity`/`WriteSecurity`. It looks locked, it isn't, and the UI that reads the flag says everything is fine. Verify by reading `roleassignments` and measuring **`BasePermissions` bits**, not the flag and not the role name.
>
> **Ve zkratce.** Zpevnění seznamu má tři kroky – rozbít dědění, prořezat zkopírovaná přiřazení, ověřit. `HasUniqueRoleAssignments` se překlopí na `true` už po **prvním**, takže kontrola, která u něj skončí, hlásí „zamčeno“ nad seznamem, kde druhý krok neproběhl. A protože bezpečná podoba breaku je `copyRoleAssignments=true`, je ten polovičatý stav **horší než prosté dědění**: kopie dá objektu vlastní přiřazení Členů s Úpravami, které nesou `ManageLists`, a tedy obcházejí `ReadSecurity`/`WriteSecurity`. Vypadá zamčeně, zamčený není, a UI čtoucí ten příznak tvrdí, že je vše v pořádku. Ověřuj čtením `roleassignments` a měř **bity `BasePermissions`**, ne příznak a ne název role.

## Symptom

An administration screen lists your app's data lists and shows a green "hardened" badge next to each one. The badge is honest about what it measured — and wrong about what it claims:

- users who should only read the list can still edit it;
- item-level `ReadSecurity: 2` / `WriteSecurity: 2` has no effect at all;
- re-running the hardening pass silently fixes it, which makes the original failure look like a fluke.

Nothing is logged, because from the code's point of view nothing failed.

## Why it happens

The safe hardening sequence is:

```
1. POST …/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=true)
2. for each unwanted assignment: removeroleassignment / addroleassignment(lower role)
3. verify
```

Step 1 uses `copy=true` deliberately — `copy=false` leaves exactly one assignment, the calling
account, which locks out administrators who reach the site through their own group (see
[Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md)).

But `copy=true` means the object now owns a **private copy** of everything it used to inherit,
including *Site Members → Edit*. Step 2 is what makes that copy safe. Step 2 is also the step
that fails in the field: a `403` when the caller lacks `ManagePermissions`, a `429` under
throttling, a network blip halfway through the loop. Step 1 has already succeeded, so:

```ts
const r = await get(`${listApi}?$select=HasUniqueRoleAssignments`);
return (await r.json()).HasUniqueRoleAssignments === true;   // ← says "hardened"
```

returns `true` over a list whose ACL is a verbatim copy of the site's. Since `Edit` includes
`ManageLists`, that principal can also flip item-level settings back
(see [`WriteSecurity: 4` needs ManageLists](write-security-4-needs-managelists.md)) — so the one
protection the list *did* have is gone too.

## What to do instead

**Verify the assignments, not the flag:**

```ts
const url = `${listApi}/roleassignments?$expand=Member,RoleDefinitionBindings`;
```

**Measure permission bits, not role names or `RoleTypeKind`.** Both are traps:

- role names are localised — a Czech tenant reports `Úpravy` and `Úplné řízení`;
- `RoleTypeKind` only identifies the *built-in* levels (`1`…`6`). A customer's own level named
  "Editor" comes back as `RoleTypeKind: 0` and sails through a `kind === 5 || kind === 6` test
  while carrying `ManageLists`.

`BasePermissions` is a 64-bit mask split into `Low`/`High`. Test the bit:

```ts
// ManageLists = bit 12 of the low word (PermissionKind.ManageLists)
const MANAGE_LISTS_LOW = 0x00000800;
const hasManageLists = (b: { Low: string; High: string }): boolean =>
  (Number(b.Low) & MANAGE_LISTS_LOW) !== 0;
```

**Model three states, not two.** `unknown` — the ACL could not be read (403 without
`EnumeratePermissions`, 429, outage) — must never render as "fine". An **empty collection with
status 200 is also `unknown`**: an object with no role assignments at all does not exist, so
"empty" means "you cannot see them", not "nobody has access".

## How to verify

Build the counter-example around the level that the trap is actually about:

- ✅ a level that **cannot** add/edit/delete but **does** hold `ManageLists`

That is the whole point of the class, and it is the case a naive verifier misses. A half-done
state built on plain `Edit` is **not** a valid test — `Edit` also grants add/edit/delete, so even
a verifier blind to `ManageLists` will flag it and report a false success.

Then sabotage one load-bearing line at a time in the compiled output — drop the `ManageLists`
check, drop the trim step, return early after the break — and confirm each one makes the test
fail. If removing the trim step still passes, the test is measuring the flag again.

## Related

- [Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md) — why `copy=true` is the safe form in the first place.
- [`WriteSecurity: 4` needs ManageLists](write-security-4-needs-managelists.md) — why the copied `Edit` role also disables item-level settings.
- [A one-sided permission check passes on an empty ACL](one-sided-permission-check-passes-on-an-empty-acl.md) — the `unknown` state, from the other direction.
