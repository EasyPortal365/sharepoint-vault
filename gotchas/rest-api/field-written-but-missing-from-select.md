---
title: A field you write is never read back — $select is an allowlist and a ?? fallback hides the gap
tags: [rest-api, odata, diagnostics, data-integrity]
applies-to: SharePoint Online (any OData $select consumer)
last-reviewed: 2026-08-12
---

# A field you write is never read back — `$select` is an allowlist and a `??` fallback hides the gap

> **Bottom line.** Adding a column to your WRITE path does nothing until the same column is added to every READ `$select`. Items come back without the property, your code sees `undefined`, and a `snapshot ?? liveValue` fallback silently computes from the live value — the exact thing the snapshot was created to prevent. Nothing throws, nothing logs; the feature just quietly does not exist.
>
> **Ve zkratce.** Přidat sloupec do ZÁPISU je k ničemu, dokud ho nepřidáš i do všech čtecích `$select`. Položky se vrací bez té vlastnosti, kód vidí `undefined` a fallback `snímek ?? živá hodnota` tiše počítá ze živé hodnoty – přesně z té, před kterou měl snímek chránit. Nic nespadne, nic se nezaloguje; funkce prostě potichu neexistuje.

## Symptom

A "snapshot" column is introduced so that historical calculations stay stable — say, the monthly allowance valid for a closed period, written by the month-close routine onto that month's record. The write works; you can see the value in the list. Yet every screen keeps recalculating history from the *current* contract value, as if the snapshot did not exist. No errors anywhere.

## Cause

Two well-behaved features compose into silence:

1. **`$select` is an allowlist.** A REST read like

   ```http
   GET …/items?$select=Id,Title,Period,BudgetHours
   ```

   returns objects that simply *lack* every unlisted property. Reading `item.AllowanceSnapshot` yields `undefined` — indistinguishable from "the routine never wrote a snapshot".

2. **The fallback is a legal branch.** The consuming code is deliberately tolerant:

   ```ts
   const allowance = item.AllowanceSnapshot != null ? item.AllowanceSnapshot : contract.AllowanceHours;
   ```

   With the property missing, this always takes the live branch. That is correct behavior for genuinely old rows — which is why nothing ever flags the missing column.

The bug survives code review because the write path, the read path and the fallback each look right in isolation.

## Rule

- The commit that adds a column to a **write** must add it to every **read** `$select` in the same change. Grep the data layer for the field name before merging — one hit (the write) means you are not done.
- Prove the snapshot wins: set snapshot ≠ live value on one row and check which number the UI shows. A fallback you have never seen *not* taken is untested code.
- Compare with `!= null`, not truthiness — `0` is a valid snapshot (a period with a zero allowance) and must not fall through to the live value.
- If the field is provisioned asynchronously on older sites, keep the field in the *extended* `$select` with a 400-fallback to a narrower select, so old sites degrade instead of failing (see `provisioning-skips-schema-changes-to-existing-fields.md`).
