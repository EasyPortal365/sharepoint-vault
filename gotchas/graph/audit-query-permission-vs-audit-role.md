---
title: "\"User:… dont have any permissions\" from the audit query API rejects the USER, not the app"
tags: [graph, purview, audit-log, permissions, exchange-online, rbac, spfx]
applies-to: Microsoft Graph (security/auditLog/queries, v1.0 + beta), Microsoft Purview Audit, Exchange Online RBAC
last-reviewed: 2026-08-21
---

# `dont have any permissions` from the audit query API

> **Bottom line.** `POST /security/auditLog/queries` fails in two different places, and the messages look nothing alike. Missing **application consent** (`AuditLogsQuery.Read.All` / `AuditLogsQuery-SharePoint.Read.All`) gives you a Graph-shaped `accessDenied`. With consent in place the call reaches the unified audit backend, which can still reject the **signed-in account** with the misspelled `{"Message":"User:<upn> dont have any permissions"}`. That is Exchange Online RBAC talking: the account may not search the audit log. A Global Administrator normally *does* have that right — inherited from the Exchange role group **Organization Management**, which is also why the Purview portal can show no role membership for an admin whose audit search works. When it fails for one account, run the check below instead of guessing: neither a mailbox nor a licence is required, so the usual suspects are not the answer.
>
> **Ve zkratce.** Dotaz na auditní log může selhat na dvou různých místech. Chybějící **souhlas s oprávněním aplikace** vrátí `accessDenied` ve tvaru Graphu. Když je souhlas udělený, volání dojde až k backendu jednotného auditního logu — a ten může odmítnout **přihlášený účet** hláškou `{"Message":"User:<upn> dont have any permissions"}`. To mluví Exchange RBAC: účet nesmí v auditu hledat. Globální správce to právo obvykle **má** (dědí ho ze skupiny rolí **Organization Management**; proto v Purview u sebe žádné členství nevidíte). Když jednomu účtu nefunguje, nehádejte příčinu — schránka ani licence podmínkou nejsou — a rovnou ji změřte příkazem níž.

## Symptom

An admin tool built on the audit query API refuses to start a query:

```
{"Message":"User:someone@contoso.onmicrosoft.com dont have any permissions"}
```

Unified auditing is on. The account is a Global Administrator. The API permission is approved. Meanwhile the same tool works fine in another tenant whose admin also has nothing but the Global Administrator role — which is exactly the observation that disproves the tempting conclusion "Global Admin is not enough".

## Cause

Two independent authorization layers guard the same call:

| Layer | What it checks | What failure looks like |
|---|---|---|
| Graph delegated permission (admin consent) | Is the *application* allowed to ask? | `accessDenied`, `Authorization_RequestDenied`, HTTP 403 from Graph |
| Audit search role (Exchange Online RBAC, surfaced in Purview) | Is the *user* allowed to search the audit log? | `User:… dont have any permissions` — from the audit backend, not from Graph |

The audit search right is the Exchange role **View-Only Audit Logs** (or **Audit Logs**). Global Administrators hold it implicitly, and the chain is worth knowing because every diagnostic question follows from it — measured on a working tenant:

```powershell
Get-ManagementRoleAssignment -RoleAssignee <admin-upn> -Role "View-Only Audit Logs"
#   Name             : View-Only Audit Logs-Organization Management
#   RoleAssigneeName : Organization Management
#   RoleAssigneeType : RoleGroup          (EffectiveUserName: All Group Members)

Get-RoleGroupMember "Organization Management"
#   Name                     RecipientType
#   TenantAdmins_-123456789  Group        <- auto-managed group holding the Global Admins
```

So: **Global Administrator → auto-managed `TenantAdmins_<hash>` group → Organization Management role group → audit roles.** That is why most tenants never configure anything, and why the Purview portal can show **no role group membership at all** for an admin whose audit search works — Purview lists Purview role groups, while this right lives in Exchange (admin center → Roles → Admin roles → Organization Management).

Two things are worth ruling out before you theorise, because both get blamed and neither is required: **a mailbox** and **a licence**. On the tenant measured above the admin account has no mailbox at all (`Get-Mailbox` returns nothing, `Get-User` reports `RecipientType: User`) and audit search works fine.

When the call fails *despite* the account being a Global Administrator, one link of that chain is broken. Check them in order rather than guessing:

1. Is the account actually **in `TenantAdmins_*`** — i.e. is the Global Administrator role *active*, not merely PIM-eligible?
2. Is `TenantAdmins_*` still a **member of Organization Management**?
3. Does Organization Management still **hold the audit roles** (`Get-ManagementRoleAssignment -Role "View-Only Audit Logs"`)?
4. Is **`UnifiedAuditLogIngestionEnabled`** true at all?

A third state is easy to confuse with both errors: **auditing disabled**. That one does not error at all — the query completes and returns zero records.

## Fix

1. Settle the question with one command instead of guessing:

```powershell
Connect-ExchangeOnline
Get-ManagementRoleAssignment -RoleAssignee "<upn>" -Role "View-Only Audit Logs"
```

Empty output means the account really lacks the role. Output plus a persisting failure points at PIM activation or propagation delay.

2. Grant it explicitly: **Microsoft Purview → Settings → Roles and scopes → Role groups** → **Audit Reader** (read-only search; enough for reporting tools) or **Audit Manager**. The Exchange equivalent is any role group carrying **View-Only Audit Logs**.
3. **Sign out and sign in again.** Exchange RBAC propagation takes tens of minutes; Microsoft documents up to 24 hours in the worst case.
4. Cheap cross-check that separates account from tenant: run the same query as a *different* licensed admin. If that works, the cause is account-specific.
5. Only when the message mentions `accessDenied` / consent, go to **SharePoint admin center → Advanced → API access** (SPFx) or the app registration and approve the permission.

## Rule of thumb

Classify the error by its **content** before advising anyone, and keep the advice falsifiable. A tool that prints one blanket hint ("check the API permission") sends admins to the wrong console; a hint that states "your role cannot possibly work" gets disproved by the first tenant where it does, and takes the rest of your diagnosis down with it. Three distinct states, three distinct messages:

* no consent → approve the application permission,
* the account cannot search → check `Get-ManagementRoleAssignment`, then add it to Audit Reader / Audit Manager,
* auditing off → turn on recording in Purview (takes up to 60 minutes and does not backfill history).
