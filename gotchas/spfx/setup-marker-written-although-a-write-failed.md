---
title: A setup marker that measures only part of the step freezes a half-provisioned site forever
short-title: Setup marker written although a write failed
summary: The success flag measured the id lookups, not the `addroleassignment` POST, so a 403 froze a site with groups that carry no permission level at all
tags: [spfx, provisioning, permissions, localstorage, rest-api, verification]
applies-to: SharePoint Online (SPFx client-side provisioning)
last-reviewed: 2026-09-19
---

# A "done" marker that measures only part of the step freezes the half-done state forever

> **Bottom line.** A client-side setup step usually ends with `if (allOk) localStorage.setItem(marker, '1')`. The trap is not the marker — it is what `allOk` actually measured. If the step creates a group and then grants it a permission level, and you only check that the *group id* and the *role definition id* came back non-null, a `403` on the `addroleassignment` POST leaves `allOk === true`. The marker is written, the step never runs again in that browser, and the site keeps groups that carry **no access level at all**. The admin screen lists the roles and looks healthy; members added to them can do nothing. Evaluate `resp.ok` on **every** write the step performs, not on the lookups that precede it.
>
> **Ve zkratce.** Klientský provisioning krok obvykle končí `if (allOk) localStorage.setItem(marker, '1')`. Past není značka, ale to, co `allOk` skutečně změřilo. Když krok založí skupinu a pak jí přidělí úroveň oprávnění, a ty kontroluješ jen to, že se vrátilo *id skupiny* a *id definice role*, nechá `403` u POST `addroleassignment` hodnotu `allOk` na `true`. Značka se zapíše, krok se v tom prohlížeči už nikdy nespustí a na webu zůstanou skupiny **bez jakékoli úrovně přístupu**. Správcovská obrazovka role vypíše a vypadá zdravě; členové v nich neumí nic. Vyhodnocuj `resp.ok` u **každého zápisu**, který krok dělá, ne u dohledávání, která mu předcházejí.

## Symptom

Roles look configured and behave as if they were not:

- the app's own "user roles" screen lists the groups and their members, with no warning;
- a user added to a role gets *Access denied* on lists the role should reach;
- re-running setup in a **different browser** sometimes fixes it, which makes the first failure look like a fluke;
- nothing is logged, because from the code's point of view nothing failed.

The giveaway is in SharePoint itself: *Site settings → Site permissions* shows the groups, and the **Permission Levels column for them is empty**.

## Cause

The step is idempotent by design, so it is written as "ensure" logic:

```ts
let allOk = true;
for (const g of GROUPS) {
  const groupId = await ensureGroup(g.name);          // creates or finds
  if (groupId === null) { allOk = false; continue; }

  const roleDefId = await getRoleDefId(g.level);      // "Contribute" → id
  if (roleDefId === null) { allOk = false; continue; }   // ← checked

  await sp.post(`${web}/_api/web/roleassignments/addroleassignment` +
                `(principalid=${groupId},roledefid=${roleDefId})`, cfg, {});
  //  ↑ result never inspected
}
if (allOk) localStorage.setItem(`app-groups-v2-${webUrl}`, '1');
```

Two conditions have to meet for the freeze, and both are ordinary:

1. **The groups already exist.** Someone ran setup before — from another account, another browser, or a previous version. `ensureGroup` therefore *finds* them and returns an id, so the first guard passes.
2. **The current user cannot grant permissions.** `addroleassignment` needs `ManagePermissions`, which ordinary members and even some site editors do not have. SharePoint answers `403`.

`SPHttpClient` does **not** throw on a non-2xx response, so the `await` resolves happily. `allOk` was only ever a statement about the two lookups. The marker is a per-browser flag, so the step is not retried on the next load, or the next day, or ever — and the one person who *could* fix it (an owner) may have a marker of their own from an earlier successful run.

## Fix

Measure the write:

```ts
const assignResp = await sp.post(url, cfg, {});
if (!assignResp.ok) {
  console.warn(`[setup] role assignment failed for ${g.name}: HTTP ${assignResp.status}`);
  allOk = false;                 // marker stays unwritten → next load retries
  continue;
}
```

Two rules that generalise beyond this endpoint:

- **A success flag must cover every operation the step performs.** Reading an id is not doing the work. Walk the step and count the writes; `allOk` must have a line for each.
- **Pair it with the opposite failure mode.** A marker written only on full success re-runs the whole batch forever for anyone who cannot complete it (see [A provisioning step gated on success runs forever](provisioning-step-gated-on-success-runs-forever.md)). The pair of gotchas has one answer: the marker needs **three** outcomes — *done*, *tried and not permitted* (short-lived, so the app stops hammering), and *tried and failed transiently* (retry soon).

## How to verify

Do not trust the flag or the app's own screen. Read the assignments back:

```
GET {web}/_api/web/sitegroups?$select=Id,Title,LoginName
GET {web}/_api/web/roleassignments?$expand=Member,RoleDefinitionBindings
    &$select=PrincipalId,Member/Title,RoleDefinitionBindings/Name
```

A group that appears in `sitegroups` but has no row in `roleassignments` is exactly this failure. Note that the group's presence — like `HasUniqueRoleAssignments` on a list — proves a step *started*, not that it finished; see [HasUniqueRoleAssignments proves the break, not the hardening](../permissions/unique-role-assignments-is-not-proof-of-hardening.md).

A quick negative test while developing: run setup as an account **without** `ManagePermissions` on a site where the groups already exist. The marker must not appear in `localStorage`, and the next page load must try again.
