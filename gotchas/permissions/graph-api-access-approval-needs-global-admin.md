---
title: "Approving Microsoft Graph permissions for SPFx needs a Global Administrator — Application Administrator is not enough"
tags: [permissions, spfx, graph, entra, roles, api-access, admin-consent]
applies-to: SharePoint Online, Microsoft Entra ID
last-reviewed: 2026-09-03
---

# Approving Microsoft Graph permissions for SPFx needs a Global Administrator — Application Administrator is not enough

> **Bottom line.** Two different approvals hide behind "an admin clicks Approve", and the *Application Administrator* role fails both of them when Microsoft Graph is involved. (1) Pending **API access** requests in the SharePoint admin center: Microsoft's docs say Application Administrator is sufficient only for *third-party* APIs — for Microsoft Graph "the Global Administrator role is required", and a plain SharePoint Administrator cannot approve at all. (2) **Admin consent on an app registration**: Application Administrator and Cloud Application Administrator consent to everything *except application permissions for Microsoft Graph* (e.g. `Sites.Selected`), which need Global Administrator or Privileged Role Administrator. Put the exact role into the customer's preflight checklist, with the citation, before the deployment meeting.
>
> **Ve zkratce.** Za „admin klikne Approve" se skrývají dvě různá schválení a role *Application Administrator* neprojde ani jedním, jakmile jde o Microsoft Graph. (1) Čekající žádosti **API access** v SharePoint admin centru: podle dokumentace stačí Application Administrator jen pro API třetích stran — pro Microsoft Graph „je vyžadována role Global Administrator" a samotný SharePoint Administrator schválit nemůže. (2) **Admin consent na app registraci**: Application/Cloud Application Administrator udělují souhlas všemu *kromě aplikačních oprávnění Microsoft Graph* (např. `Sites.Selected`) — ta chtějí Global Administrator nebo Privileged Role Administrator. Přesnou roli napište do preflight checklistu zákazníka i s citací, dřív než začne nasazení.

## Symptom

A deployment session is scheduled with the customer's SharePoint Administrator and Application Administrator. The `.sppkg` goes into the App Catalog fine, the `webApiPermissionRequests` show up under **API access** — and nobody in the room can approve them. Later the same day an app registration for a background job (`Sites.Selected`) is created without problems, but **Grant admin consent** is greyed out for the Application Administrator. Both look like "missing permissions somewhere", and both are documented behaviour.

## Cause

Two separate rules, both from Microsoft Learn:

| Approval | Where | Who can do it |
|---|---|---|
| Pending SPFx permission requests (delegated Graph scopes) | SharePoint admin center → Advanced → API access | Microsoft Graph or any other Microsoft API → **Global Administrator**. Application Administrator suffices only for third-party APIs registered in the tenant. Global Reader cannot even open the page. |
| Admin consent for **application** permissions of Microsoft Graph (e.g. `Sites.Selected`) | Entra → App registrations → API permissions | **Global Administrator** or **Privileged Role Administrator**. Application Administrator / Cloud Application Administrator explicitly *exclude* "application permissions for Azure AD Graph and Microsoft Graph" — they can still *request* them, not *grant* them. |

Sources: *Manage access to Microsoft Entra ID-secured APIs* (learn.microsoft.com/sharepoint/api-access — note under the page overview) and *Microsoft Entra built-in roles* (learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference — role descriptions of Application Administrator and Cloud Application Administrator).

## What to do

- In the customer's **preflight checklist** name the role per approval, and quote the sentence from Microsoft's docs — the customer's IT will otherwise (reasonably) assume "Application Administrator manages applications".
- Delegated Graph scopes requested by SPFx land on the *SharePoint Online Client Extensibility Web Application Principal*; approving them once is tenant-wide, so a single Global Administrator session at deployment time is enough — plan for it, don't discover it.
- If you cannot get a Global Administrator at all, the API access requests can also be approved with `Approve-SPOTenantServicePrincipalPermissionRequest` — by an account with the same role, so that is a workflow change, not a way around the role.
- For the background job, `Sites.Selected` is still the right choice (least privilege: access is then granted per site). The consent click is the only step that needs the higher role; everything after it (per-site grants) works with the app's own credentials plus a site owner.

## Verify

After approval, the delegated scopes are visible under Entra → Enterprise applications → *SharePoint Online Client Extensibility Web Application Principal* → Permissions. Users must sign out and back in — a token issued before the approval does not carry the new scope, which looks like "approved but still not working".
