---
title: Hiding a field in an SPFx web part is not a permission
tags: [security, spfx, permissions, rest-api]
applies-to: SharePoint Online (SPFx / any client rendering list data)
last-reviewed: 2026-07-23
---

# Hiding a field in an SPFx web part is not a permission

> **Bottom line.** Role-based field hiding in a client-side web part is cosmetic — anyone with Read on the list pulls the "hidden" column straight from `_api`, Export to Excel, or a second web part. For real confidentiality the data has to live somewhere the role has no Read (a separate list/library with unique permissions, item-level permissions, or behind a server-side tier); the UI toggle is hygiene, not a boundary.
>
> **Ve zkratce.** Skrytí pole podle role v klientském web partu je jen kosmetika – kdokoli s právem Read na list si „skrytý" sloupec vytáhne přes `_api`, přes Export do Excelu nebo druhým web partem. Pro skutečnou důvěrnost musí data ležet tam, kde role nemá Read (samostatný list/knihovna s vlastními právy, oprávnění na úrovni položky, nebo za serverovou vrstvou); přepínač v UI je hygiena, ne hranice.

## Symptom

You implement "field-level permissions": a config says role *X* must not see the `Cost` / `Margin` / `Salary` column, and your React web part dutifully hides those fields. It demos as locked down. Then someone:

- opens `…/_api/web/lists/getbytitle('Deals')/items?$select=Id,Cost` in the browser and reads every value, or
- clicks **Export to Excel** / opens the classic list view (both bypass your web part entirely), or
- reads the same list from a second web part, Power Automate, Graph, or Search.

The "hidden" data was never hidden.

## Cause

SPFx runs in the **user's** browser with the **user's** permissions. Hiding a field in React only changes what your component paints — it does nothing to what the signed-in user is allowed to request. If they have Read on the list, every column is reachable through REST (`_api`), Microsoft Graph, SharePoint Search, the classic UI, list views, **Export to Excel**, and any other web part, flow, or script running as them.

And SharePoint has **no field-level security**. The finest native grain is the **item** (list items and documents can carry unique permissions); there is no "this column is invisible to that group." So there is no server-side state your UI toggle could even be reflecting.

## Fix

Decide which of two different requirements you actually have — they have different solutions:

**1. Hygiene** ("don't clutter juniors with a cost column; avoid shoulder-surfing"). UI hiding is fine — just don't call it security, and be exhaustive. When you hide a field in one place, strip it from **every other exit in the same app**:

- CSV / clipboard / "Export" buttons,
- generated Word/PDF or mail-merge output,
- print/detail views and secondary components.

A single un-gated export button re-leaks the whole column.

**2. Confidentiality** ("this role must not be able to read these amounts"). The data has to move to where the role has no Read:

- **Separate list or library** for the sensitive fields, inheritance broken, granted only to the roles that may see them. Surface it through a component that runs with the viewer's own permissions, so a restricted user simply gets an empty result.
- **Item-level permissions** if the split is per-record rather than per-field.
- **Server-side tier** (e.g. an Azure Function with app-only auth and its own authorization checks) that returns only the projection a given role may see. The browser never receives the raw field.

## Notes

- **"Read-only" has the same illusion.** A `disabled` input (or a `readonly` flag in your config) doesn't stop a `PATCH` from the console. Enforce writes with list permissions or a server tier, not with `disabled`.
- Treat adding field hiding as a data-exit audit: enumerate every path the value can leave by — drawer, list, kanban, export, document generation, search, and REST used by other parts — and gate them all, or you've moved the leak, not closed it.
- The **separate-list** approach doubles as your audit boundary: because the field physically isn't in the main list, "did we accidentally expose it?" becomes a permissions question you can actually answer.
- This is the field-level cousin of the item-level rule: SharePoint security is per-item at best, so design the *storage* around who may read, not the *rendering*.
