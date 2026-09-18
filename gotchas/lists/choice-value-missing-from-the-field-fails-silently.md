---
title: A Choice value your field does not know rejects the write - and a best-effort logger swallows it
tags: [lists, choice, provisioning, auditing, data-quality]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-18
---

# A Choice value your field does not know rejects the write - and a best-effort logger swallows it

> **Bottom line.** A Choice column refuses any value outside its `Choices` list with HTTP 400. When the writer is deliberately best-effort - an audit log that must never break the action it records - nothing surfaces. The entries simply are not there, and the gap is invisible until someone needs them.
>
> **Ve zkratce.** Choice sloupec odmítne hodnotu mimo svůj výčet chybou HTTP 400. Když je zapisovač záměrně best-effort – auditní log, který nesmí shodit akci, kterou zaznamenává – neprojeví se to nikde. Záznamy prostě nevzniknou a díra se pozná, až je někdo potřebuje.

## Symptom

An audit or history list is missing entries for a few specific actions. The rest of the log is fine, so it does not read like a broken feature - it reads like "those actions apparently do not get logged". No error, no console warning, no failed request in the UI.

## Cause

Two declarations that must match had drifted apart:

```ts
// code
export type AuditAction = 'create' | 'delete' | 'archive' | /* ... */ | 'offboard' | 'merge';

// provisioning manifest
{ internalName: 'Action', type: 'Choice', choices: ['create', 'delete', 'archive' /* ...and no more */] }
```

The writer is best-effort on purpose:

```ts
public async log(action: AuditAction, ...): Promise<void> {
  try { /* POST */ } catch { /* never break the caller */ }
}
```

So every write of an action missing from `choices` returns 400 and is dropped on the floor. The type-checker cannot help: both sides are valid on their own, and nothing in the language ties a union type to a literal array in another file.

A reconciler that widens `Choices` on already-deployed sites does not save you either, because its source of truth is the same manifest where the values are missing.

## Rules

1. **Make the contract machine-checked.** Both sides are literals, so a small build script can parse them and compare. Fail the build on a mismatch, and check the human-readable labels in the same pass.
2. **A deliberately swallowed error needs a static counterpart.** Where failure is invisible at runtime by design, the defect can only be found before runtime.
3. **Widening a Choice column needs a schema-version bump.** Existing sites reconcile only when the provisioning version changes; without the bump, the new value keeps failing everywhere it is already deployed.
4. **Scope the "already reconciled" marker per site.** `localStorage` is shared across the whole origin, so a key without the site URL marks the work done after the first site and never runs on the second.
5. **Test the guard by breaking it.** Remove one value in a scratch copy and confirm the script exits non-zero - a guard that has never failed has never been shown to work.

## Quick check

```bash
# Values the code can produce vs. values the field accepts
grep -oE "'[a-z-]+'" src/**/AuditService.ts | sort -u
grep -A2 "internalName: 'Action'" src/**/Provisioning*.ts
```
