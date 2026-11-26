---
title: System fields that start with an underscore are `OData__…` in REST – the bare name gives 400 on items and a silent `{}` on a file
short-title: Underscore fields need the OData__ prefix
summary: "`$select=_UIVersionString` or `_ModerationStatus` on `lists(...)/items` returns 400 \"field or property does not exist\"; on `GetFileBy…/ListItemAllFields` it returns 200 `{}` and silently drops the field – use `OData__UIVersionString` / `OData__ModerationStatus` (the response uses the same prefixed keys); `/fields` still lists the bare `InternalName`"
tags: [rest-api, lists, versioning, moderation, odata]
applies-to: SharePoint Online
last-reviewed: 2026-11-27
---

# System fields that start with an underscore are `OData__…` in REST

> **Bottom line.** A field whose internal name starts with `_` (`_UIVersionString`, `_ModerationStatus`, `_ModerationComments`, `_CopySource`…) is exposed by the REST item endpoints as `OData_` + name, i.e. `OData__UIVersionString`. The bare name fails in two different ways: on `lists(...)/items` it is a **400**, on a file's `ListItemAllFields` it is a **200 with `{}`** – the field is silently left out, and code that reads "missing" as "not set" takes the wrong branch. `/fields` still reports the bare `InternalName`, so a field list built from it is right while the `$select` built next to it is wrong.
>
> **Ve zkratce.** Pole, jehož interní jméno začíná `_` (`_UIVersionString`, `_ModerationStatus`, …), se v REST položek jmenuje `OData_` + jméno, tedy `OData__UIVersionString`. Holé jméno selže dvojím způsobem: u `lists(...)/items` vrátí **400**, u `ListItemAllFields` souboru **200 s `{}`** – pole tiše vypadne a kód, který „chybí“ čte jako „není nastaveno“, jde špatnou větví. `/fields` přitom vrací holé `InternalName`, takže seznam polí z něj je správně a `$select` hned vedle špatně.

## Symptom

Code that registers files from a library, or checks their approval state, works in unit tests (the fixtures were written with the same bare names) and then fails against a real library:

- reading items throws 400 "The field or property _UIVersionString does not exist";
- reading the approval state of one file returns nothing, so the code assumes the library has no content approval, skips `Approve`, and later finds the file still at a minor version.

## Measured on SharePoint Online (2026-11-27)

Document library with versioning, minor versions and content approval on; one published file (1.0) and one draft (0.1).

```
GET _api/web/lists(guid'<id>')/items?$select=Id,_UIVersionString
→ 400  "The field or property _UIVersionString does not exist."

GET _api/web/lists(guid'<id>')/items?$select=Id,_ModerationStatus
→ 400

GET _api/web/lists(guid'<id>')/items?$select=Id,OData__ModerationStatus,OData__UIVersionString
→ 200  [{"Id":1,"OData__ModerationStatus":0,"OData__UIVersionString":"1.0"}, …,
        {"Id":3,"OData__ModerationStatus":3,"OData__UIVersionString":"0.1"}]

GET _api/web/GetFileByServerRelativePath(decodedurl='<path>')/ListItemAllFields?$select=_ModerationStatus
→ 200  {}

GET _api/web/GetFileByServerRelativePath(decodedurl='<path>')/ListItemAllFields?$select=OData__ModerationStatus,OData__UIVersionString
→ 200  {"OData__ModerationStatus":0,"OData__UIVersionString":"1.0"}
```

The response keys carry the same prefix, so read `item.OData__UIVersionString`, not `item._UIVersionString`.

## Rule

- In `$select`, `$filter`, `$orderby` and when reading the item JSON, use `OData__<name>` for every field whose internal name starts with an underscore.
- The bare name is still right in `/fields` (`InternalName`) and in `ValidateUpdateListItem` (`FieldName: "_ModerationStatus"`).
- Build the test fixture for a new REST query from a **live response**, not from memory – otherwise the test confirms the author's assumption.
- Moderation values: 0 approved, 1 rejected, 2 pending, 3 draft.

## Related

- [List item versions are newest-first](list-item-versions-are-newest-first-and-include-current.md)
