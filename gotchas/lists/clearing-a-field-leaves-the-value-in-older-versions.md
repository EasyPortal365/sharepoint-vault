---
title: Clearing a field does not remove the value — every older version still shows it
short-title: Clearing a field leaves it in older versions
summary: On a list with versioning, setting a field to null only adds a new version; anyone who can read the item reads the old value from `items(id)/versions`. Deleting the old version with `versions(<VersionId>)/DeleteObject()` removes it for good — it does not go to the recycle bin
tags: [versioning, lists, privacy, gdpr, personal-data, rest-api, migration]
applies-to: SharePoint Online
last-reviewed: 2026-11-16
---

# Clearing a field does not remove the value — every older version still shows it

> **Bottom line.** You move sensitive data (IP addresses, user agents, national IDs) out of a widely readable list and "clear" the old field with a MERGE. On a list with versioning on, that MERGE only creates a new version. The cleared value is still in the previous version, and anyone who can read the item can read it through `items(<id>)/versions` or the Version history dialog. The migration reports success and hides nothing. To really remove the value, delete the older versions too: `POST …/items(<id>)/versions(<VersionId>)/DeleteObject()`. Measured: the version is gone and it does **not** go to the recycle bin, so this step is permanent.
>
> **Ve zkratce.** Citlivý údaj (IP adresy, User-Agent, rodná čísla) přesouváte z široce čitelného seznamu jinam a staré pole „vymažete“ přes MERGE. V seznamu se zapnutými verzemi tím jen vznikne nová verze. Vymazaná hodnota zůstává v předchozí verzi a každý, kdo smí číst položku, si ji přečte přes `items(<id>)/versions` nebo v dialogu Historie verzí. Migrace hlásí úspěch, a přitom nic neskryla. Skutečné odstranění znamená smazat i starší verze: `POST …/items(<id>)/versions(<VersionId>)/DeleteObject()`. Změřeno: verze zmizí a do koše **nejde**, takže je to trvalý krok.

## Symptom

An audit finds personal data in a list that every employee can read. New records start writing that data into a separate, restricted list. The old records get a cleanup pass that copies the value across and sets the old field to empty. Every item now shows an empty field, yet the Version history of any item still shows the old value in version 1.0.

## Measure it yourself

On a throwaway list (template 100, `EnableVersioning: true`) with one text column `Secret`:

1. Add an item with `Secret = '203.0.113.7'`.
2. Clear it: `POST /_api/web/lists/…/items(<id>)` with `X-HTTP-Method: MERGE`, `IF-MATCH: *` and the body `{ "Secret": null }`. The response is `204`.
3. Read the item: `Secret` is `null` and `OData__UIVersionString` is `2.0`.
4. Read the versions with `GET …/items(<id>)/versions?$select=VersionLabel,Secret`:

```json
[
  { "VersionLabel": "2.0", "Secret": null },
  { "VersionLabel": "1.0", "Secret": "203.0.113.7" }
]
```

5. Delete the old version with `POST …/items(<id>)/versions(512)/DeleteObject()`. The response is `200`. Version 1.0 has VersionId 512, which is major × 512.
6. Read the versions again: only `2.0` is left. The site recycle bin (`/_api/web/RecycleBin`, newest first) has no entry for the deleted version.

## Cause

A list item version is a full copy of every field at that moment (see [A version is a full copy, not a delta](a-version-is-a-full-copy-not-a-delta.md)). The versions inherit the item's read permission. Whoever can read the item can read all its versions and every field in them. Item-level read security (`ReadSecurity`) and hiding the list do not change that.

## Fix

- **Before you "clear" personal data,** check `EnableVersioning` and `MajorVersionLimit` on the list. If versioning is on, removing the data means clearing the field **and** deleting the older versions of that item. Deleting a version is permanent and skips the recycle bin. Make it a deliberate, owner-approved admin action with a preview, not a silent migration that runs on page load.
- **Do not just turn versioning off** if anything relies on the history. On evidence and audit records the history usually *is* the evidence.
- **For the new restricted list,** decide on versioning on purpose (often off). If users write their own rows, accept a row only when its server-side `AuthorId` matches the author of the record it belongs to.
- **Wording:** do not tell users "personal data removed" while older versions still exist.

## What this does not prove

The measurement ran as a site collection administrator. That a reader of the item can open its versions follows from versions inheriting the item's permission. It was not re-measured under a read-only account. Retention policies and holds (Purview) keep their own copy in the Preservation Hold Library, and deleting a version does not touch that copy.

## See also

- [A version is a full copy, not a delta](a-version-is-a-full-copy-not-a-delta.md)
- [Major version limit zero means unlimited](major-version-limit-zero-means-unlimited.md)
