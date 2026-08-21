---
title: "\"User:… dont have any permissions\" from the audit query API is a missing ROLE, not a missing consent"
tags: [graph, purview, audit-log, permissions, exchange-online, rbac, spfx]
applies-to: Microsoft Graph (security/auditLog/queries, v1.0 + beta), Microsoft Purview Audit, Exchange Online RBAC
last-reviewed: 2026-08-21
---

# `dont have any permissions` from the audit query API

> **Bottom line.** `POST /security/auditLog/queries` can fail in two completely different places. Missing **application consent** (`AuditLogsQuery.Read.All` / `AuditLogsQuery-SharePoint.Read.All`) produces a Graph-shaped `accessDenied`. Once consent is there, the call reaches the unified audit backend, which rejects the **signed-in account** with the misspelled `{"Message":"User:<upn> dont have any permissions"}`. That second one means the user is not in an audit search role — and **Global Administrator does not grant it**. Add the account to the Purview role group **Audit Reader** (or **Audit Manager**), then sign out and back in.
>
> **Ve zkratce.** Dotaz na auditní log může selhat na dvou různých místech. Chybějící **souhlas s oprávněním aplikace** vrátí `accessDenied` ve tvaru Graphu. Když je souhlas udělený, volání dojde až k backendu jednotného auditního logu, a ten odmítne **přihlášený účet** hláškou `{"Message":"User:<upn> dont have any permissions"}` (ano, s překlepem). To znamená, že účet nemá roli pro hledání v auditu — a **role globálního správce ji nedává**. Přidejte účet do skupiny rolí **Audit Reader** (nebo **Audit Manager**) v Microsoft Purview a nechte ho znovu přihlásit.

## Symptom

An admin tool built on the audit query API refuses to start a query:

```
{"Message":"User:someone@contoso.onmicrosoft.com dont have any permissions"}
```

The tenant has unified auditing turned on. The account is a Global Administrator. The API permission is listed as approved. Everything looks right — and nothing works.

## Cause

Two independent authorization layers guard the same call, and their failures look similar in a UI that only prints the raw message:

| Layer | What it checks | What failure looks like |
|---|---|---|
| Graph delegated permission (admin consent) | Is the *application* allowed to ask? | `accessDenied`, `Authorization_RequestDenied`, HTTP 403 from Graph |
| Audit search role (Exchange Online RBAC, surfaced in Purview) | Is the *user* allowed to search the audit log? | `User:… dont have any permissions` — a message from the audit backend, not from Graph |

The second layer is the one people miss, because directory roles feel like they should cover it. They do not: Microsoft stopped implicitly granting audit search rights to tenant admin roles, so a brand-new Global Administrator can hold every directory role in Entra and still be unable to run a single audit search.

A third state is easy to confuse with both: **auditing disabled**. That one does not error at all — the query completes and returns zero records.

## Fix

1. **Microsoft Purview portal → Settings → Roles and scopes → Role groups** → open **Audit Reader** (read-only search; enough for reporting tools) or **Audit Manager** (search + configure) → add the account.
   *Equivalent path:* Exchange admin center → Roles → Admin roles → a role group carrying **View-Only Audit Logs** (or **Audit Logs**).
2. **Sign out and sign in again.** Exchange RBAC propagation is not instant — expect tens of minutes; Microsoft documents up to 24 hours in the worst case.
3. Confirm outside your own app, which separates "your code is wrong" from "the tenant is not ready":

```powershell
Connect-ExchangeOnline
# Fails with the same message => it is the role, not your application.
Search-UnifiedAuditLog -StartDate (Get-Date).AddDays(-1) -EndDate (Get-Date) -ResultSize 1
```

4. Only if the message mentions `accessDenied` / consent, go to **SharePoint admin center → Advanced → API access** (SPFx) or the Entra app registration and approve the permission.

## Rule of thumb

Classify the error by its **content** before advising anyone. A tool that prints one blanket hint ("check the API permission") for every failure sends admins to the wrong console — and the tenant that actually has the consent will look like your bug. Three distinct states, three distinct messages:

* no consent → approve the permission,
* no audit role → add the account to Audit Reader / Audit Manager,
* auditing off → turn on recording in Purview (takes up to 60 minutes and does not backfill history).
