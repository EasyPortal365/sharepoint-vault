---
title: "`signInActivity` without Entra ID P1 — the retry without it turns \"not measured\" into \"0 inactive users\""
short-title: signInActivity without P1 reports zero inactive users
summary: Selecting `signInActivity` on `/users` fails with 403 in tenants without Entra ID P1/P2; the common fallback (retry without the property) makes every user look "never signed in" or gets skipped, so inactive-user and unused-licence reports silently show 0 — store an explicit "not measured" state instead
tags: [graph, users, signinactivity, licensing, entra-id, reporting]
applies-to: Microsoft Graph v1.0 /users, delegated or application permissions
last-reviewed: 2026-10-09
---

# `signInActivity` without Entra ID P1 — the retry without it turns "not measured" into "0 inactive users"

> **Bottom line.** `GET /users?$select=…,signInActivity` needs an Entra ID P1/P2 licence in the tenant (plus `AuditLog.Read.All`). Without it Graph answers 403 ("Neither tenant is B2C or tenant doesn't have premium license"). The usual defensive code retries without `signInActivity` — and from then on every user has an empty last sign-in, so an "inactive for 90 days" filter either skips them all or the report shows **0**. Zero is a claim ("nobody is inactive"); what you actually have is "not measured". Store that explicitly and show it.
>
> **Ve zkratce.** `signInActivity` na `/users` vyžaduje v tenantu licenci Entra ID P1/P2 (a `AuditLog.Read.All`). Bez ní Graph vrátí 403. Obvyklý obranný kód zkusí dotaz znovu bez té vlastnosti – a pak má každý uživatel prázdné poslední přihlášení, takže filtr „neaktivní 90 dní" je všechny přeskočí nebo report ukáže **0**. Nula je tvrzení („nikdo není neaktivní"), přitom skutečný stav je „nezměřeno". Ulož to výslovně a ukaž to.

## Situation

You build an inactive-users, stale-guests or unused-licences report on Graph:

```http
GET https://graph.microsoft.com/v1.0/users?$select=id,userPrincipalName,accountEnabled,assignedLicenses,signInActivity&$top=999
```

It works in your dev tenant (which has Business Premium, E3/E5 or an Entra ID P1 trial). In a tenant with only Business Basic/Standard it returns **403**. Microsoft documents the requirement and the error text in
[Neither tenant is B2C or tenant doesn't have premium license](https://learn.microsoft.com/troubleshoot/entra/entra-id/users-groups-entra-apis/b2c-or-tenant-premium-license-sign-in-activities)
and in [How to detect inactive user accounts](https://learn.microsoft.com/entra/identity/monitoring-health/howto-manage-inactive-user-accounts).

## The trap

```ts
let users;
try {
  users = await getAll('/users?$select=id,upn,assignedLicenses,signInActivity');
} catch {
  users = await getAll('/users?$select=id,upn,assignedLicenses'); // "graceful" fallback
}
const inactive = users.filter(u => u.signInActivity?.lastSuccessfulSignInDateTime
  && daysSince(u.signInActivity.lastSuccessfulSignInDateTime) > 90);
// → [] in every tenant without P1. The dashboard proudly says "0 inactive".
```

The fallback is right — you still want the list of users and licences — but the information *that the measurement did not happen* is thrown away. Downstream, a rule engine closes the finding ("resolved"), a KPI tile shows `0` and a cost estimate shows `0 Kč`.

## Fix

Keep the fallback, but return the measurement state alongside the data and make every consumer honour it:

```ts
type SignInMeasure = { measured: true } | { measured: false; reason: 'premium' | 'forbidden' | 'error' };

async function loadUsers(): Promise<{ users: User[]; signIn: SignInMeasure }> {
  try {
    return { users: await getAll(Q_WITH_SIGNIN), signIn: { measured: true } };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const users = await getAll(Q_WITHOUT_SIGNIN);
    return { users, signIn: { measured: false, reason: status === 403 ? 'premium' : 'error' } };
  }
}
```

- **Rules / findings:** when `measured === false`, produce no "inactive" finding *and* do not auto-close an existing one — treat the source as unread.
- **UI:** show `?` or "not measured — requires Entra ID P1" instead of `0`; if part of a total *was* measured (e.g. disabled accounts), show it as a lower bound (`≥ 3`).
- **Persist it:** if you store snapshots, store the flag too, otherwise a later trend chart turns the gap into a real-looking dip.
- `accountEnabled`, `assignedLicenses` and `/subscribedSkus` do **not** need P1 — disabled-but-licensed accounts and unassigned seats can still be reported.

## See also

- [`perUserMfaState` says "disabled" under Conditional Access](per-user-mfa-state-lies-under-conditional-access.md) — another report that needs P1 and fails quietly.
