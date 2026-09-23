---
title: A Choice value your field does not know is stored anyway — so a drifted vocabulary never announces itself
tags: [lists, choice, provisioning, auditing, data-quality]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# A Choice value your field does not know is stored anyway — so a drifted vocabulary never announces itself

> **Bottom line.** Writing a value that is not in a Choice column's `Choices` does not fail: REST stores it verbatim (201 on create, 204 on MERGE, and even the `Validate…` endpoints accept it). So when the values your code can write and the values the field declares drift apart, nothing at runtime tells you — the only place that can catch it is a build-time check of the two lists against each other.
>
> **Ve zkratce.** Zápis hodnoty, která v `Choices` Choice sloupce není, neselže: REST ji uloží doslova (201 při založení, 204 u MERGE a přijmou ji i endpointy `Validate…`). Když se tedy rozejdou hodnoty, které umí zapsat kód, a hodnoty, které deklaruje sloupec, za běhu se to nedozvíš nikde – zachytit to umí jen kontrola obou seznamů při buildu.

> **Correction (2026-09-24).** The first version of this article said the opposite: that such a write fails with HTTP 400 and a best-effort logger swallows it, so audit entries silently never exist. That was inferred from an older note, not measured. A live test on SharePoint Online showed the write succeeds — the measurements are in [Choice fields accept any value over REST](../rest-api/choice-fields-accept-any-value.md). The rules below survive the correction; the reason for them changed.

## Symptom

The values your code can write and the values the column declares have drifted apart, and nothing complains:

```ts
// code
export type AuditAction = 'create' | 'delete' | 'archive' | /* ... */ | 'offboard' | 'merge';

// provisioning manifest
{ internalName: 'Action', type: 'Choice', choices: ['create', 'delete', 'archive' /* ...and no more */] }
```

Writes of `offboard` and `merge` succeed. The items exist, carrying values the field definition does not list. Anything built from the definition rather than from the data — the dropdown in a form, a filter or picker generated from `Choices`, a reconciler that widens `Choices` from the manifest — does not know those values.

## Cause

REST does not check Choice values against `Choices`, and `FillInChoice` makes no difference, so there is no runtime error to see — or to swallow. The type-checker cannot help either: both sides are valid on their own, and nothing in the language ties a union type to a literal array in another file.

A reconciler that widens `Choices` on already-deployed sites does not close the gap, because its source of truth is the same manifest where the values are missing.

## Rules

1. **Make the contract machine-checked.** Both sides are literals, so a small build script can parse them and compare. Fail the build on a mismatch, and check the human-readable labels in the same pass.
2. **Where runtime stays silent, the build has to speak.** SharePoint accepts the value, and a best-effort writer would swallow an error anyway — the drift can only be found before runtime.
3. **Widening a Choice column needs a schema-version bump** (or whatever re-runs your reconcile). Existing sites reconcile only when the provisioning version changes; without the bump, the new value stays missing from the definition everywhere the column is already deployed.
4. **Scope the "already reconciled" marker per site.** `localStorage` is shared across the whole origin, so a key without the site URL marks the work done after the first site and never runs on the second.
5. **Test the guard by breaking it.** Remove one value in a scratch copy and confirm the script exits non-zero — a guard that has never failed has never been shown to work.
6. **Don't explain a failed write with the vocabulary.** If a write really fails, look at the body format, a missing column or the headers — an unknown Choice value is not the cause.

## Quick check

```bash
# Values the code can produce vs. values the field declares
grep -oE "'[a-z-]+'" src/**/AuditService.ts | sort -u
grep -A2 "internalName: 'Action'" src/**/Provisioning*.ts
```

## Notes

- [Choice fields accept any value over REST](../rest-api/choice-fields-accept-any-value.md) — the measurements: `POST`, `MERGE`, `ValidateUpdateListItem` and `AddValidateUpdateItemUsingPath` all store an unknown value verbatim.
- [A new Choice value in your provisioning code never reaches already-deployed sites](../rest-api/provisioning-skips-schema-changes-to-existing-fields.md) — how to reconcile the definition without narrowing it.
