---
title: The Purview Audit Query API is asynchronous — think in hours, not seconds
tags: [graph, audit, purview, compliance]
applies-to: Microsoft Graph (Microsoft 365)
last-reviewed: 2026-07-15
---

# The Purview Audit Query API is asynchronous — think in *hours*, not seconds

> **Bottom line.** The Purview audit query API is an asynchronous background job that can sit in `running` for over an hour (and `v1.0` may 404 while `beta` works), so build the UI to show the last `succeeded` query first and create new ones in the background.
>
> **Ve zkratce.** Purview audit query API je asynchronní úloha na pozadí, která může zůstat ve stavu `running` přes hodinu (a `v1.0` může vracet 404, zatímco `beta` funguje), takže UI postav tak, aby nejdřív ukázalo poslední `succeeded` dotaz a nové vytvářelo na pozadí.

## Symptom

You build the obvious flow against the audit log query API (`/security/auditLog/queries`): create a query, poll for a bit, show the records. In testing it never finishes "for a bit" — a query can sit in `running` for **over an hour** even on a small tenant. Bonus confusion: the same endpoints may **404 with `UnknownError` on `v1.0`** while working fine on `beta`.

## Cause

Audit queries are server-side background jobs over cold storage — the API contract is explicitly asynchronous, and the duration is not a function of your tenant's size or your patience. Separately, Microsoft has (more than once) let the `v1.0` route lag behind `beta` — a 404 `UnknownError` there does **not** mean auditing is off or the route never existed.

## Fix

Design the UI around the asynchrony instead of fighting it:

1. **List first** — `GET /security/auditLog/queries` (newest first) and attach to the most recent **`succeeded`** query's `/records` (paged via `@odata.nextLink`). The user sees data immediately — yesterday's data, but immediately.
2. **Create in the background** — fire the new query and *don't* block on it; it'll be the "fresh" one next visit (or poll lazily).
3. **Derive "auditing is enabled" from actual records** (count > 0), not from whether a query ran — a succeeded query over an empty log proves nothing.
4. **Version fallback** — try `v1.0`, fall back to `beta` on failure, and remember which one worked for the session.

## Notes

- Diagnostic discipline that saved us here: a nonsense `$orderby` returning **400** proves the route and auth are fine (a dead route would 404) — one throwaway request separates "API broken" from "my request broken".
- "It works in the Purview portal" verifies nothing about the Graph route — the portal talks to a different backend.
- Permissions: the audit query endpoints require the dedicated `AuditLogsQuery.Read.All` scope (admin consent), not the general audit-log read scopes from older APIs.
