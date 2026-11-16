---
title: An idempotent grant logged as "added" makes undo remove access the person already had
short-title: Undo of an idempotent grant removes pre-existing access
summary: "`addroleassignment` and adding a login to a SharePoint group both return success when the role or membership already exists, so an audit that records the call — not the change — later drives an undo that removes access granted long before; measure first with `roleassignments/getbyprincipalid(id)/roledefinitionbindings` (404 = no assignment) and record whether the state pre-existed"
tags: [permissions, rest-api, audit, undo]
applies-to: SharePoint Online
last-reviewed: 2026-11-17
---

# Undo of an idempotent grant removes pre-existing access

> **Bottom line.** `roleassignments/addroleassignment(principalid=…,roledefid=…)` and `POST sitegroups(id)/users` both succeed when the role or membership is already there. If your tool logs "granted Contribute" for that call and later builds an undo from the log, the undo removes the role — and the person loses access they had long before your change. Read the live state before the write, skip the write when it already exists, and store `preexisting: true|false` with the audit record so the undo can leave it alone.
>
> **Ve zkratce.** Přidání úrovně i přidání do skupiny SharePointu projde i tehdy, když tam úroveň nebo členství už je. Nástroj, který do auditu zapíše „přidáno“ a z auditu pak skládá vrácení, odebere přístup, který člověk měl dávno před zásahem. Před zápisem změř živý stav, existující stav nepřidávej a do auditu ulož `preexisting` (true i false), aby ho vrácení nechalo.

## Symptom

- A permissions tool changes someone's level (or adds them to a group) and offers "Undo".
- The person already had that level directly, or was already in that group.
- After Undo they have *less* access than before the change — the level or membership that pre-dated the change is gone.

## Cause

Both writes are idempotent and return 2xx whether or not anything changed. Measured: calling `addroleassignment` twice for the same principal and role returns **200** both times and leaves one binding; posting the same login to `sitegroups(id)/users` twice returns **201** both times and leaves one member. The audit records what was **called**, and the inverse step is derived from the call: `addRole` → `removeRole`, `addToGroup` → `removeFromGroup`.

## Fix

1. **Don't plan what is already there.** If the principal already holds the target role directly, leave the `addRole` step out of the plan (keep only the removal of the extra roles).
2. **Measure before the write, strictly.**
   - Role on an object: `GET <object>/roleassignments/getbyprincipalid(<id>)/roledefinitionbindings?$select=Id`
     - **404** (`System.ArgumentException`, "Can not find the principal with id") = the principal has **no** assignment on this object (measured on a web and on a list).
     - **200** = the list of role definition Ids it holds.
     - Anything else: stop — don't write on an unread state.
   - Group membership: `GET /_api/web/sitegroups(<id>)/users?$select=Id,LoginName` and compare logins (case-insensitive, claim prefix stripped).
3. **Record the result every time** — `preexisting: true` *and* `false`. An undo then:
   - skips `preexisting: true` and says so ("this access was already here before the change");
   - treats a record **without** the flag as written by an older version and warns that it can't tell.

The general rule: any write whose inverse will be derived from an audit log must log **what changed**, not what was called.

## Related

- [Breaking inheritance without copying keeps only you](break-without-copy-keeps-only-you.md)
