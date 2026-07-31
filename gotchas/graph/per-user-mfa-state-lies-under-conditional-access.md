---
title: "perUserMfaState says \"disabled\" even when MFA is enforced — don't report it as \"user has no MFA\""
tags: [graph, mfa, entra-id, conditional-access, security, reporting]
applies-to: Microsoft Graph (beta) /users/{id}/authentication/requirements, Microsoft Graph v1.0 /reports/authenticationMethods/userRegistrationDetails
last-reviewed: 2026-07-31
---

<!-- Verified live on 2026-07-31 against a tenant without an Entra ID premium license. -->


# `perUserMfaState` says "disabled" even when MFA is enforced

> **Bottom line.** Per-user MFA (`perUserMfaState`) is the *legacy* enforcement switch. When a tenant enforces MFA through Conditional Access or security defaults — which is the norm — every user stays `disabled` while being fully protected. Reading that field and rendering "no MFA" is a false statement, not a rounding error. To report on MFA, use `/reports/authenticationMethods/userRegistrationDetails` (registration is a fact regardless of enforcement method); use `perUserMfaState` only alongside the tenant's actual enforcement context.
>
> **Ve zkratce.** Per-user MFA (`perUserMfaState`) je *legacy* přepínač vynucení. Když tenant vynucuje MFA přes Conditional Access nebo výchozí nastavení zabezpečení – tedy běžný stav – zůstávají všichni uživatelé `disabled`, přestože chránění jsou. Vzít tohle pole a napsat „uživatel nemá MFA" není nepřesnost, ale nepravda. Pro reporting používej `/reports/authenticationMethods/userRegistrationDetails` (registrace platí bez ohledu na způsob vynucení); `perUserMfaState` ukazuj jen spolu s kontextem, čím tenant MFA reálně vynucuje.

## Symptom

You build an "MFA status" column over the obvious-looking endpoint:

```http
GET https://graph.microsoft.com/beta/users/{id}/authentication/requirements
→ { "perUserMfaState": "disabled" }
```

Every user in the tenant comes back `disabled`. The dashboard reports "0 % of users have MFA" — while the same users are demonstrably prompted for MFA at every sign-in, and the admin center shows the tenant as protected.

Nothing is broken. The API answered correctly; the question was wrong.

## Cause

Entra ID has **three independent ways** to require MFA:

| Mechanism | Where it lives | Effect on `perUserMfaState` |
|---|---|---|
| Conditional Access policy | `/identity/conditionalAccess/policies` | **none** — users stay `disabled` |
| Security defaults | `/policies/identitySecurityDefaultsEnforcementPolicy` | **none** — users stay `disabled` |
| Per-user MFA (legacy) | `/users/{id}/authentication/requirements` | this is the field itself |

Microsoft states it plainly in the per-user MFA documentation: *"Enabling Microsoft Entra multifactor authentication through a Conditional Access policy doesn't change the state of the user. Don't be alarmed if users appear disabled."*

So `perUserMfaState` answers only "is this user enrolled in the **legacy** per-user mechanism", which for most modern tenants is "no, and that's fine". It is not a measure of whether the user has MFA.

The same docs also warn against mixing the two: *"Don't enable or enforce per-user Microsoft Entra multifactor authentication if you use Conditional Access policies."* A UI that offers a per-user toggle without surfacing that context invites admins to break their own tenant.

## Fix

**For "does this user have MFA?" use the registration report** (v1.0, delegated `AuditLog.Read.All`):

```http
GET https://graph.microsoft.com/v1.0/reports/authenticationMethods/userRegistrationDetails
```

```jsonc
{
  "id": "86462606-…",
  "userPrincipalName": "alex@contoso.com",
  "isMfaRegistered": true,      // has a strong method registered
  "isMfaCapable": true,         // …and policy allows it for MFA
  "isAdmin": false,             // admin accounts: missing MFA matters most here
  "methodsRegistered": ["microsoftAuthenticatorPush", "softwareOneTimePasscode"]
}
```

Registration is independent of *how* the tenant enforces MFA, so it is the one number that holds in every tenant.

**If you do show the per-user state, show the enforcement context next to it.** Two cheap reads (delegated `Policy.Read.All`) answer "what actually enforces MFA here":

```http
GET /policies/identitySecurityDefaultsEnforcementPolicy   → { "isEnabled": true }
GET /identity/conditionalAccess/policies                  → filter state == "enabled"
                                                            && grantControls.builtInControls contains "mfa"
```

Treat each of those as **three-valued**: `true` / `false` / *couldn't read it*. Collapsing "couldn't read" into `false` reintroduces the same lie one level up.

## Watch out for

- 🔴 **The registration report needs an Entra ID P1/P2 tenant — and the docs don't say so.** On a tenant without a premium license the call fails with:

  ```
  HTTP 403 · Authentication_RequestFromNonPremiumTenantOrB2CTenant:
  Tenant is not a B2C tenant and doesn't have premium license
  ```

  The endpoint's permissions table lists only the scope and the supported directory roles, so this condition cannot be derived from the documentation — only from a live call. Handle it as its own case: telling an admin to "add the Reports Reader role" when the tenant simply has no P1 sends them somewhere that cannot help. `perUserMfaState` (beta) rejects the same tenants, so on Entra ID Free there is no Graph route to MFA status at all — say so and point at the admin center instead of rendering an empty column.
- **The registration report omits disabled (blocked) accounts.** The docs note: *"This method doesn't work for disabled users."* A missing row therefore means *no data*, never *no MFA*. Render it as "not stated".
- **Reading the report needs a directory role**, not just the scope: Reports Reader, Security Reader, Security Administrator, or Global Reader. A tenant admin's app registration having `AuditLog.Read.All` is not enough if the signed-in user holds none of those roles — you get 403. Fail loudly with the actual Graph error rather than rendering an empty (i.e. "nobody has MFA") table.
- **Writing `perUserMfaState` is beta-only.** There is no v1.0 equivalent; Microsoft's standard warning applies (*"Use of these APIs in production applications is not supported"*). Writing needs delegated `Policy.ReadWrite.AuthenticationMethod` plus the Authentication Policy Administrator role (least privileged supported).
- `isMfaRegistered` vs `isMfaCapable` are not the same: a user can have a method registered that the authentication methods policy no longer permits for MFA. Reporting only `isMfaRegistered` overstates coverage.

## See also

- [Enable per-user MFA](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-mfa-userstates)
- [List userRegistrationDetails](https://learn.microsoft.com/en-us/graph/api/authenticationmethodsroot-list-userregistrationdetails?view=graph-rest-1.0)
- [Update authentication method states (beta)](https://learn.microsoft.com/en-us/graph/api/authentication-update?view=graph-rest-beta)
