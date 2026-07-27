---
title: Telling a list's own columns from inherited ones — `Hidden` is not enough
tags: [rest-api, lists, fields, provisioning]
applies-to: SharePoint Online (REST `/fields`)
last-reviewed: 2026-07-28
---

# Telling a list's own columns from inherited ones — `Hidden` is not enough

> **Bottom line.** When you read `/_api/web/lists(guid'…')/fields` to copy a list's schema somewhere else, filtering on `Hidden` and `ReadOnlyField` still leaves you with ~40 inherited columns (`Created`, `Modified`, `Author`, `_UIVersionString`, …). The two properties that actually separate "this list's own columns" from the base template's are **`FromBaseType`** and **`CanBeDeleted`**.
>
> **Ve zkratce.** Když čtete `/_api/web/lists(guid'…')/fields`, abyste schéma seznamu přenesli jinam, filtr na `Hidden` a `ReadOnlyField` vám stejně nechá ~40 zděděných sloupců (`Created`, `Modified`, `Author`, `_UIVersionString`, …). Vlastní sloupce seznamu od těch ze šablony odliší až **`FromBaseType`** a **`CanBeDeleted`**.

## Symptom

You are snapshotting a list or library — reading its fields to recreate them on another site. You filter out the obvious noise:

```
/_api/web/lists(guid'<id>')/fields?$select=InternalName,Title,TypeAsString,Hidden,ReadOnlyField
```

…drop everything `Hidden` or `ReadOnlyField`, and still end up with dozens of columns you never created: `Title`, `Modified`, `Editor`, `Author`, `FileSizeDisplay`, `ItemChildCount`, `_ComplianceTag`, and friends. Recreating those on the target either fails (they already exist) or produces a schema nobody asked for.

## Cause

`Hidden` means "not shown in forms/views", not "not yours". Plenty of inherited columns are perfectly visible — `Modified` and `Editor` are the obvious ones. `ReadOnlyField` catches computed columns but not, say, `Title`.

The list schema is a *union*: columns from the base content type / list template, plus columns added to this list. SharePoint exposes that distinction directly:

| Property | Meaning | Use |
|---|---|---|
| `FromBaseType` | column comes from the base type (list template / parent content type) | `true` → not the list's own |
| `CanBeDeleted` | the field can be removed from the list | `false` → system-managed |
| `Hidden` | not rendered in forms/views | useful, but orthogonal |
| `ReadOnlyField` | value is computed, not writable | useful, but orthogonal |

## Fix

Ask for the discriminating properties and filter client-side:

```
/_api/web/lists(guid'<id>')/fields
  ?$select=InternalName,Title,TypeAsString,Hidden,ReadOnlyField,FromBaseType,CanBeDeleted,Choices,DisplayFormat,SelectionMode,CustomFormatter
  &$top=300
```

```ts
const isOwnColumn = (f) =>
  !f.Hidden && !f.ReadOnlyField && !f.FromBaseType && f.CanBeDeleted !== false;
```

Keep a small blocklist on top for the handful that slip through on document libraries (`Title`, `DocIcon`, `LinkFilename`, `ItemChildCount`, `_Compliance*`, `MediaServiceImageTags`) — they vary by template and tenant configuration, and a name-based guard is cheaper than discovering each one in the field.

## Notes

- ⚠ **The same filter is wrong for view columns.** A view rebuilt from "own columns only" looks amputated — no icon, no name, no modified date. When you snapshot `views(guid'…')/viewfields`, take **all** of them, inherited ones included. Own-vs-inherited matters for *creating* columns, not for *listing* them in a view.
- `Choices` comes back either as a plain array or wrapped in `{ results: [...] }` depending on the OData flavour of the response — handle both.
- Do not try to reverse-engineer a column's `CustomFormatter` into your own template model. Copy the JSON verbatim; a silent, slightly-wrong translation is worse than a faithful snapshot that you label as "will not auto-update".
- If the read fails, return the failure explicitly. Returning an empty schema makes "I couldn't read it" indistinguishable from "there is nothing here", and the caller happily saves the emptiness. See [Silent fallbacks poison destructive writes](silent-fallbacks-poison-destructive-writes.md).
