---
title: "PATCH on Entra ID policy objects replaces collections and complex values whole — send everything you read, change one field"
short-title: "Entra policy PATCH replaces complex values whole"
summary: groupSettings values, onPremisesSynchronization features and deviceRegistrationPolicy (PUT) are not merged field by field — a partial body silently resets the rest; also, security defaults need Policy.ReadWrite.ConditionalAccess and refuse to turn on while any Conditional Access policy exists
tags: [graph, entra-id, policies, patch, security-defaults, hybrid-identity]
applies-to: Microsoft Graph v1.0 /groupSettings, /directory/onPremisesSynchronization, /policies/deviceRegistrationPolicy, /policies/identitySecurityDefaultsEnforcementPolicy
last-reviewed: 2026-11-21
---

<!-- Based on the Microsoft Graph v1.0 reference and OData update semantics, checked 2026-11-21. groupSettings and deviceRegistrationPolicy writes were exercised on a tenant without a premium license; the onPremisesSynchronization write was NOT exercised live (no hybrid tenant available). -->

# PATCH on Entra ID policy objects replaces complex values whole

> **Bottom line.** "PATCH = change only what I send" holds for *simple top-level properties*. For a **collection** (`groupSetting.values`) or a **complex-typed property** (`onPremisesDirectorySynchronization.features`, `configuration`), the value you send *replaces* the stored one. And `deviceRegistrationPolicy` is updated with **PUT**, which replaces the whole object. Read the object, deep-copy the complex property, change one field inside it, send the full copy back — and keep that read as the undo snapshot.
>
> **Ve zkratce.** „PATCH mění jen to, co pošlu“ platí jen pro *jednoduché vlastnosti na nejvyšší úrovni*. **Kolekce** (`groupSetting.values`) nebo **vlastnost komplexního typu** (`onPremisesDirectorySynchronization.features`, `configuration`) se odeslanou hodnotou *nahradí* celá. `deviceRegistrationPolicy` se mění přes **PUT**, který přepíše celý objekt. Přečti objekt, zkopíruj celou komplexní vlastnost, změň v ní jedno pole a pošli celou kopii zpět – přečtený stav si nech jako podklad pro vrácení.

## Symptom

You want to flip one switch and send a minimal body:

```http
PATCH https://graph.microsoft.com/v1.0/directory/onPremisesSynchronization/{id}
{ "features": { "blockSoftMatchEnabled": true } }
```

The call returns `204 No Content`. Nothing looks wrong — but every other flag in `features` (password hash sync, user writeback, …) is now at its default, because `features` is a complex value and it was replaced, not merged.

The same pattern bites elsewhere:

| Object | Shape | What a partial body does |
|---|---|---|
| `/groupSettings/{id}` | `values` is a collection of name/value pairs | Sending only the pair you change drops the others back to template defaults |
| `/directory/onPremisesSynchronization/{id}` | `features`, `configuration` are complex types | Sending one flag resets the rest of that complex value |
| `/policies/deviceRegistrationPolicy` | updated with **PUT** | Anything you omit is overwritten |

## Fix

```ts
const cur = await graph.api(url).get();                 // also your undo snapshot
const features = JSON.parse(JSON.stringify(cur.features)); // full copy
features.blockSoftMatchEnabled = true;                     // change one field
await graph.api(url).patch({ features });                  // send the whole complex value
```

- For `groupSettings`, send the complete `values` array with only one `value` changed.
- For PUT endpoints, send the whole object you read (minus read-only properties).
- Re-read before each write; if the object changed since your plan was shown, stop.
- Undo = the same full-value write with the snapshot.

## Related trap: turning on security defaults

`PATCH /policies/identitySecurityDefaultsEnforcementPolicy { "isEnabled": true }`:

- needs the delegated **`Policy.ReadWrite.ConditionalAccess`** permission (no narrower one exists) and the **Conditional Access Administrator** role at least;
- fails while the tenant has **any** Conditional Access policy, in any state (on, off or report-only);
- since July 2024 there is **no 14-day registration grace**: users without MFA must register at their next sign-in; legacy authentication and device code flow get blocked; there are no exclusions.

If your tool carries `Policy.ReadWrite.ConditionalAccess` only for this switch, add a build-time test that fails when any code path writes to `/identity/conditionalAccess/...` — the permission itself does not limit you to security defaults.

## Sources

- [Update groupSetting](https://learn.microsoft.com/graph/api/groupsetting-update)
- [Update onPremisesDirectorySynchronization](https://learn.microsoft.com/graph/api/onpremisesdirectorysynchronization-update)
- [Update deviceRegistrationPolicy](https://learn.microsoft.com/graph/api/deviceregistrationpolicy-update)
- [Update identitySecurityDefaultsEnforcementPolicy](https://learn.microsoft.com/graph/api/identitysecuritydefaultsenforcementpolicy-update)
- [Security defaults in Microsoft Entra ID](https://learn.microsoft.com/entra/fundamentals/security-defaults)
