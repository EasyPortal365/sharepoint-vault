---
title: Exchange Online Admin API (the REST behind EXO V3) cannot be called from the browser — no CORS, and SPFx tokens lack Exchange.Manage
short-title: Exchange Admin API — no CORS from SPFx
summary: "adminapi/beta/{tenant}/InvokeCommand fails with 'Failed to fetch' even with a fake token; read Exchange config with an admin-run script and import, or use Graph message trace and mailbox reports"
tags: [exchange, spfx, cors, graph, admin]
applies-to: Exchange Online, SharePoint Framework, Microsoft Graph
last-reviewed: 2026-11-06
---

# Exchange Online Admin API (the REST behind EXO V3) cannot be called from the browser — no CORS, and SPFx tokens lack Exchange.Manage

> **Bottom line.** The REST endpoint the Exchange Online PowerShell module V3 uses (`https://outlook.office365.com/adminapi/beta/{tenantId}/InvokeCommand`) sends no CORS headers for a SharePoint origin, so `fetch` from an SPFx page fails before authentication. The token SPFx issues for `https://outlook.office365.com` carries only mail scopes anyway, not `Exchange.Manage`. Read Exchange configuration with a script the admin runs and an import of its output; for mail flow and mailbox data use Graph.
>
> **Ve zkratce.** REST, které používá modul Exchange Online PowerShell V3 (`https://outlook.office365.com/adminapi/beta/{tenantId}/InvokeCommand`), neposílá pro původ SharePointu hlavičky CORS, takže `fetch` ze stránky SPFx selže ještě před ověřením. Token, který SPFx pro `https://outlook.office365.com` vydá, nese stejně jen poštovní obory, ne `Exchange.Manage`. Konfiguraci Exchange čti skriptem, který spustí správce, a importem výstupu; tok pošty a data schránek ber z Graphu.

## Symptom

From an SPFx web part you try to list mailboxes, forwarding or mailbox permissions without an app-only registration. Every request to `adminapi` ends with `TypeError: Failed to fetch`, no HTTP status, no readable body.

## Cause

Measured from a modern SharePoint page as a global admin (November 2026):

- `aadTokenProviderFactory.getTokenProvider().getToken('https://outlook.office365.com')` succeeds, but the `scp` claim lists only `Mail.*`, `Calendars.*`, `User.*`, `Group.*`, `People.*`, `Files.*`, `Tasks.*` — no `Exchange.Manage`.
- `fetch` to `adminapi/beta/{tenantId}/InvokeCommand` and to `…/Mailbox` fails with `Failed to fetch` **even with a made-up token**, so the browser blocks it before the server looks at authentication.
- A `securitypolicyviolation` listener caught nothing, so it is not the page's Content Security Policy. A `mode: 'no-cors'` request goes out (opaque response).
- Control: `https://outlook.office.com/api/v2.0/me` with a made-up token returns a readable `401` — the mail API allows CORS, the admin API does not.

## Fix

- **Exchange configuration** (forwarding, Full Access / Send As, inbox rules, remote domains): generate a PowerShell script (`Get-Mailbox`, `Get-MailboxPermission`, `Get-InboxRule`, `Get-RemoteDomain`), let the admin run it, and import the output into your app.
- **Message trace:** Graph `GET /admin/exchange/tracing/messageTraces` with delegated `ExchangeMessageTrace.Read.All` (last 90 days, 100 requests per 5 minutes per tenant). It needs a one-time service principal for Microsoft's app `8bd644d1-64a1-4d4b-ae52-2e0cbf64e373` in the tenant; without it the call returns 403 "Service principal-less authentication failed".
- **Mailbox size, activity and type:** beta `reports/getMailboxUsageDetail(period='D7')?$format=application/json` returns `recipientType` (`User`, `Shared`), `hasArchive`, quotas and storage — see [usage reports in the browser](usage-reports-cors-blocked-in-browser.md).

**How to tell CORS from CSP:** call the endpoint with a fake token while a `securitypolicyviolation` listener is attached. A CSP block fires the event; a CORS block does not, and the same URL succeeds with `mode: 'no-cors'`.

## Sources

- List messageTraces (permissions, throttling): https://learn.microsoft.com/graph/api/messagetracingroot-list-messagetraces?view=graph-rest-1.0
- Graph-based message trace API onboarding (service principal): https://learn.microsoft.com/exchange/monitoring/trace-an-email-message/graph-api-message-trace
- Live measurement, November 2026 (as described above).
