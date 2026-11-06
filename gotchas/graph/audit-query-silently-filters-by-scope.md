---
title: Purview audit query API — a query for a service you have no scope for still "succeeds" with 0 records
short-title: Audit query filters silently by scope
summary: "With only AuditLogsQuery-SharePoint.Read.All, Exchange and Entra queries return 201 → succeeded → 0 records; an unfiltered query returns only SharePoint records"
tags: [graph, audit, purview, permissions, spfx]
applies-to: Microsoft Graph security/auditLog/queries (v1.0 and beta)
last-reviewed: 2026-11-06
---

# Purview audit query API — a query for a service you have no scope for still "succeeds" with 0 records

> **Bottom line.** The Graph audit query API (`/security/auditLog/queries`) does not reject a query for a workload your token has no `AuditLogsQuery-<Service>.Read.All` scope for. The query is accepted, runs to `succeeded` and returns **zero records**. An unfiltered query returns only the records of the workloads you do have scope for. An empty result is therefore not proof that nothing happened.
>
> **Ve zkratce.** API dotazů auditu (`/security/auditLog/queries`) neodmítne dotaz na službu, ke které token nemá obor `AuditLogsQuery-<Služba>.Read.All`. Dotaz přijme, doběhne do `succeeded` a vrátí **nula záznamů**. Dotaz bez filtru vrátí jen záznamy služeb, ke kterým obor máš. Prázdný výsledek proto není důkaz, že se nic nestalo.

## Symptom

You extend an audit screen from SharePoint to Exchange or Entra ID. The query for Exchange items or for the `AzureActiveDirectory` service is created (201), finishes as `succeeded` and has no records. The screen says "no activity" — on a tenant where people sign in and send mail every day.

## Cause

Measured from a SharePoint page with a delegated token that carried only `AuditLogsQuery-SharePoint.Read.All` (global admin, November 2026):

| Query for one day | Result |
|---|---|
| `recordTypeFilters: ["sharePointFileOperation"]` | `succeeded`, 57 records |
| `recordTypeFilters: ["exchangeItem"]` | `succeeded`, **0** records |
| `serviceFilters: ["AzureActiveDirectory"]` | `succeeded`, **0** records |
| no filter at all | `succeeded`, 540 records — **all** SharePoint record types, none from Exchange, Entra ID or Teams |

The service applies the scope by filtering the records, not by refusing the query. (A direct A/B with a second scope granted was not part of this test.)

## Fix

- Before you interpret a result, check which `AuditLogsQuery-*` scopes the token carries (decode the `scp` claim). A service without a scope is **"not measured"**, never "no activity".
- Treat "unfiltered" as "everything I have scope for" and say so in the UI.
- Request the per-service scopes you need (`AuditLogsQuery-Exchange.Read.All`, `-Entra.Read.All`, `-OneDrive.Read.All` …, or `AuditLogsQuery.Read.All`), then repeat the test.

## OneDrive is not a separate case here

OneDrive file activity arrives as `SharePointFileOperation` records with service `SharePoint` and an object path on `-my.sharepoint.com/personal/` — in the same test, 26 such records over 14 days, confirmed by the OneDrive usage report. A query with `recordTypeFilters: ["oneDrive"]` over the same 14 days returned **0**. So the SharePoint scope does cover OneDrive files, and a zero for the `oneDrive` record type means nothing. Recognise OneDrive by the path, not by the record type.

## Related limits worth knowing

From the Graph throttling documentation (security audit log query service limits): at least 200 query submissions per tenant in a rolling 24 hours, 50 queued or running queries, and 1,000,000 records per query. Hitting the record limit is **not an error** — the query ends as `succeeded`; check `isRecordCountLimitExceeded` instead of comparing counts. A one-day query took 2.5–3 minutes to finish in this test, a 14-day query (3,103 records) about 8 minutes.

## Sources

- Microsoft Graph service-specific throttling limits — Security audit log query service limits: https://learn.microsoft.com/graph/throttling-limits#security-audit-log-query-service-limits
- Live measurement, November 2026 (as described above).
