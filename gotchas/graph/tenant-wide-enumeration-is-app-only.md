---
title: Tenant-wide enumeration in Graph is app-only — check Delegated vs Application before you build
tags: [graph, permissions, sites, architecture]
applies-to: Microsoft Graph
last-reviewed: 2026-07-16
---

# Tenant-wide enumeration in Graph is **app-only** — check Delegated vs Application *before* you build

> **Bottom line.** Tenant-wide enumeration like `getAllSites` is Application-only — a delegated token just returns 403 (and a `catch → []` hides it), so check the permissions table for your token type before building, and substitute an admin PowerShell export when you're delegated-only.
>
> **Ve zkratce.** Enumerace celého tenantu typu `getAllSites` je jen pro Application oprávnění – delegovaný token vrátí 403 (a `catch → []` ho skryje), takže před stavbou ověř v tabulce oprávnění řádek pro svůj typ tokenu a při delegated-only nasazení volání nahraď exportem z admin PowerShellu.

## Symptom

You add `GET /sites/getAllSites` (or `GET /sites` list-all) to a delegated-auth app to enumerate every site collection. The `Sites.Read.All` scope exists, admin consent is granted, the new build is verifiably running — and the feature silently does nothing.

## Cause

`getAllSites` (v1.0 *and* beta) — like most "enumerate the whole tenant" surfaces (list-all sites, directory-wide reports) — supports **Application permissions only**. A delegated token gets **403**, and if your code has a fail-safe `catch → []`, the 403 vanishes and the feature just quietly under-delivers.

The trap layers beautifully: *the scope name is the same for both token types*. That consent could be granted proves nothing about whether **your token type** is supported — that's a per-endpoint column in the docs.

## Fix

1. **Before implementing any Graph call, read the Permissions table** in its docs page and check the row for *your* token type. Delegated, by design, returns "what the signed-in user can see" — endpoints that promise *everything* are app-only almost by definition.
2. If your architecture is deliberately delegated-only (a legitimate choice — no standing application permissions to explain to security), use a **delegated-safe substitute**: have the admin run the official module and import the result —

   ```powershell
   Get-SPOSite -Limit All | ConvertTo-Json -Depth 3 | Set-Clipboard
   ```

   — then merge that inventory (by URL) with what search/delegated calls can see. Admin-side PowerShell sees everything; the app just consumes the export.
3. While debugging any new Graph path, make fail-safe catches **log the status** temporarily — a silently swallowed 403 can masquerade as "consent hasn't propagated" for a very long time.

## Notes

- Diagnostic signature: *"consent granted + new version definitely running + feature silent"* on a delegated call → suspect an app-only endpoint, not consent propagation.
- SP Search (`contentclass:STS_Site`) misses sites that aren't (yet) in the search index — it's a *trimmed view*, not an inventory. The [reports/CORS gotcha](usage-reports-cors-blocked-in-browser.md) has the full decision map.
