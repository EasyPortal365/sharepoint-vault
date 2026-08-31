---
title: A permission check that only asks "who has too much?" passes on an empty ACL
tags: [permissions, security, rest-api, verification]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-01
---

# A permission check that only asks "who has too much?" passes on an empty ACL

> **Bottom line.** After tightening a scope, the natural assertion is *"no principal outside the allow-list can write."* That assertion is also satisfied by a scope where **nobody at all** can write — the worst outcome scores as a clean pass. Verification needs the second question too: *"do the intended writers still have write?"*, with a non-zero count. The same one-sidedness hides a transient failure: a helper that answers `0` or `[]` to any non-OK response lets a 429 drop a whole group out of the policy, and the check congratulates you for it.
>
> **Ve zkratce.** Po zpřísnění oprávnění se přirozeně ptáme „nemá někdo víc, než má mít?“ – jenže tuhle podmínku splní i objekt, na který nemůže zapisovat vůbec nikdo, a nejhorší možný výsledek se odškrtne jako v pořádku. Ověření potřebuje i druhou otázku: „mají ti praví pořád zápis?“, a to s nenulovým počtem. Stejná jednostrannost skryje i výpadek – funkce, která na jakoukoli ne-OK odpověď vrátí `0` nebo `[]`, nechá přechodný 429 vypustit celou skupinu z politiky a kontrola to pochválí.

## Symptom

The hardening step logs `OK`, the report is green, and one of these turns up days later:

- an approver cannot publish, and has not been able to since the change;
- a scheduled job that writes into the list has been failing with `403` in silence;
- the ACL lists the correct groups but **one is missing** — the one whose principal lookup happened to hit a throttled moment.

Re-running the very same check still says everything is fine, because everything it asks about is still true.

## Cause

Two separate one-way mistakes that reinforce each other.

**1. The assertion has one direction.** The rule you wrote down was "only Approvers and Owners may write here", so the code checks the complement:

```ts
const offenders = assignments.filter(a => !allowed(a) && canWrite(a));
const pass = offenders.length === 0;         // true for an ACL with zero writers
```

Every degenerate outcome satisfies it: an empty ACL, a scope where the grant call failed, a scope that was broken but never re-granted. "Nobody has too much" is not the same claim as "the right people have enough", and only the first one is easy to test — which is precisely why it is the one that gets tested.

**2. The inputs are read leniently.** Resolving the principals usually looks like this:

```ts
const groupId = await getGroupIdOrZero(title);   // returns 0 on any failure
if (groupId) grants.push({ id: groupId, role: ROLE.contribute });
```

`getGroupIdOrZero` cannot distinguish *"there is no such group"* from *"I could not ask right now"*. A single `429` or an expired digest silently removes a group from the intended policy — and because the removal only ever *reduces* access, the one-sided check sees an improvement.

## Fix

**Assert both directions, and make the positive one count.**

```ts
const ras = await getStrict(
  `${web}/_api/web/GetList('${listUrl}')/roleassignments` +
  `?$expand=Member,RoleDefinitionBindings&$select=PrincipalId,Member/Title,RoleDefinitionBindings/Name`
);

const writers = ras.value.filter(canWrite);                       // Add/Edit/Delete or ManageLists
const strangers = writers.filter(ra => allowedIds.indexOf(ra.PrincipalId) === -1);
const missing  = allowedIds.filter(id => writers.every(w => w.PrincipalId !== id));

const pass = strangers.length === 0        // nobody has too much
          && missing.length === 0          // everyone intended still has enough
          && writers.length > 0;           // and "everyone intended" was not an empty list
```

The third condition is not redundant: if the allow-list itself came from the lenient lookup above, it can be empty, and an empty list is trivially all-present.

**Make the reads strict on the write path.** A read that decides a write must distinguish "absent" from "unknown":

```ts
type Read<T> = { ok: true; data: T } | { ok: false; status: number };
// 404 on every candidate path => genuinely absent, act on it
// anything else               => unknown, abort the policy write and retry next run
```

Never let "unknown" collapse into "absent" while a permission change is in flight. Related traps spell this out at length: [*"File is missing" vs. "I cannot read it"*](../rest-api/missing-file-404-vs-cannot-read.md) and [*Silent fallbacks poison destructive writes*](../rest-api/silent-fallbacks-poison-destructive-writes.md).

**Verify as the affected identity, not as an admin.** Role assignments say what was granted; effective permissions say what a person gets. Site collection administrators bypass unique permissions and item-level settings entirely, so a successful write from your own account is not evidence:

```
GET /_api/web/GetList('<server-relative-url>')/getusereffectivepermissions(@u)
    ?@u='i:0%23.f|membership|megan@contoso.com'
```

Run it for one identity from each side of the boundary — one intended writer, one intended reader — and decode the mask carefully; an off-by-one turns an ordinary member into "no access" (see [*Effective permissions come as a bitmask*](../security/effective-permissions-bitmask-off-by-one.md)).

## Notes

- Report the counts, not a boolean. "3 writers, 0 strangers" is reviewable; `pass: true` is not, and a later regression to "0 writers, 0 strangers" reads the same.
- The `200` on a `breakroleinheritance` / `addroleassignment` call means the request was accepted, not that the resulting ACL is what you intended. Always re-read the assignments as the last step.
- The same shape of mistake appears outside permissions — any check whose failure mode is "less of something" is passed by the total absence of that something. Deletion sweeps, retention rules and content filters share it.

## Related

- [Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md) — the most common way a scope ends up with too few writers
- [WriteSecurity 4 ignores Contribute](write-security-4-needs-managelists.md)
- [Don't cache a throttled permission probe](../rest-api/dont-cache-a-throttled-permission-probe.md) — the same 429, cached into a lasting downgrade
- [A page-size cap reported as a finding](../rest-api/page-size-cap-reported-as-a-result.md) — another measurement that describes the request, not the tenant
