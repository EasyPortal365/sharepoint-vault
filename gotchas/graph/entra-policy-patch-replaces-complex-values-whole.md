---
title: "Updating Entra ID policy objects from Graph: groupSettings and deviceRegistrationPolicy are replaced whole — send everything you read, change one field"
short-title: "Entra policy writes that replace the whole value"
summary: groupSettings needs the entire values collection and deviceRegistrationPolicy is a PUT with all properties — a minimal body is not a partial update; for nested complex values (onPremisesSynchronization features) merge behaviour is undocumented, so send the full read value; also, security defaults need Policy.ReadWrite.ConditionalAccess, are either/or with Conditional Access and exclude only directory sync accounts
tags: [graph, entra-id, policies, patch, security-defaults, hybrid-identity]
applies-to: Microsoft Graph v1.0 /groupSettings, /policies/deviceRegistrationPolicy, /directory/onPremisesSynchronization, /policies/identitySecurityDefaultsEnforcementPolicy
last-reviewed: 2026-11-21
---

<!-- Based on the Microsoft Graph v1.0 reference, checked 2026-11-21. groupSettings and deviceRegistrationPolicy writes were exercised on a tenant without a premium license; the onPremisesSynchronization write was NOT exercised live (no hybrid tenant available). -->

# Updating Entra ID policy objects from Graph: some writes replace the whole value

> **Bottom line.** "Send only the field I change" is not how every Entra ID policy endpoint works. `groupSettings` requires the **entire `values` collection**, and `deviceRegistrationPolicy` is updated with **PUT** and a body with **all updatable properties**. For nested complex values (`onPremisesSynchronization.features`) the reference does not say whether a partial object is merged. Safe pattern for all of them: read the object, deep-copy the value, change one field, send the full copy back — and keep that read as the undo snapshot.
>
> **Ve zkratce.** „Pošlu jen pole, které měním“ neplatí u všech endpointů zásad Entra ID. `groupSettings` vyžaduje **celou kolekci `values`** a `deviceRegistrationPolicy` se mění přes **PUT** s tělem obsahujícím **všechny upravitelné vlastnosti**. U vnořených komplexních hodnot (`onPremisesSynchronization.features`) dokumentace neříká, zda se částečný objekt sloučí. Bezpečný postup pro všechny: přečti objekt, zkopíruj hodnotu celou, změň jedno pole, pošli celou kopii zpět – přečtený stav si nech jako podklad pro vrácení.

## Symptom

You flip one switch with a minimal body, the way the examples look:

```http
PATCH https://graph.microsoft.com/v1.0/groupSettings/{id}
{ "values": [ { "name": "AllowToAddGuests", "value": "false" } ] }
```

The reference for this call says the opposite of what the example suggests: *you must include the entire collection set; you cannot update a single set of values*. A body with one pair is not a "change one setting" request.

| Object | What the reference says | Safe body |
|---|---|---|
| `/groupSettings/{id}` | `values`: "You must include the entire collection set." | The whole `values` array you read, one `value` changed |
| `/policies/deviceRegistrationPolicy` | **PUT**; supply the object "with all the updatable properties" (all marked Required) | The whole object you read, minus read-only properties |
| `/directory/onPremisesSynchronization/{id}` | PATCH; properties not in the body keep their values. Whether a *partial* `features` or `configuration` object is merged is **not stated** | The whole `features` (or `configuration`) object you read, one flag changed |

## Fix

```ts
const cur = await graph.api(url).get();                    // also your undo snapshot
const features = JSON.parse(JSON.stringify(cur.features)); // full copy
features.blockSoftMatchEnabled = true;                     // change one field
await graph.api(url).patch({ features });                  // send the whole value
```

- Re-read right before each write; if the object changed since you showed the plan, stop.
- Undo = the same full-value write with the snapshot.
- `onPremisesSynchronization` writes need `OnPremDirectorySynchronization.ReadWrite.All` and the signed-in user must be a **Global Administrator** (the only supported role).

## Related trap: turning on security defaults

`PATCH /policies/identitySecurityDefaultsEnforcementPolicy { "isEnabled": true }`:

- needs delegated **`Policy.Read.All` and `Policy.ReadWrite.ConditionalAccess`** (no narrower write permission exists) and at least the **Conditional Access Administrator** role;
- is an either/or with Conditional Access: Microsoft says organizations that implement Conditional Access must disable security defaults — check for existing Conditional Access policies before you offer the switch;
- since 29 July 2024 there is **no 14-day registration grace**: users without MFA must register when prompted at sign-in; legacy authentication and device code flow get blocked;
- has no configurable exclusions — only directory synchronization accounts (Entra Connect / Cloud Sync) are skipped by Microsoft, so emergency access accounts need MFA too.

If your tool carries `Policy.ReadWrite.ConditionalAccess` only for this switch, add a build-time test that fails when any code path writes to `/identity/conditionalAccess/...` — the permission itself does not limit you to security defaults.

## Sources

- [Update groupSetting](https://learn.microsoft.com/graph/api/groupsetting-update)
- [Update deviceRegistrationPolicy](https://learn.microsoft.com/graph/api/deviceregistrationpolicy-update)
- [Update onPremisesDirectorySynchronization](https://learn.microsoft.com/graph/api/onpremisesdirectorysynchronization-update)
- [Update identitySecurityDefaultsEnforcementPolicy](https://learn.microsoft.com/graph/api/identitysecuritydefaultsenforcementpolicy-update)
- [Security defaults in Microsoft Entra ID](https://learn.microsoft.com/entra/fundamentals/security-defaults)
