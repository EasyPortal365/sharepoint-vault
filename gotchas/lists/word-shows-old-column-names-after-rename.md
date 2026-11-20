---
title: Word shows the old column names after you rename or hide library columns — the server is right, the open copy is not
short-title: Word shows old column names after a rename
summary: "The library and the downloaded file already carry the new names; Word desktop shows the schema of the copy it had open — reopen before you touch content types"
tags: [lists, content-types, office, word, document-properties]
applies-to: SharePoint Online, Word for Windows
last-reviewed: 2026-11-20
---

# Word shows the old column names after you rename or hide library columns — the server is right, the open copy is not

> **Bottom line.** After you change a library column's `Title` or `Hidden`, Word for Windows can keep showing the internal name (and the hidden column) under File → Info → Properties, with a yellow "Document Updates Available" bar on top. The library is already correct: the list field, the content type's field and `FieldLinks` carry the new values, and the file you download from the library already contains the current schema, even if it was last saved before the change. Word is showing the schema of the copy it had open or cached. Close Word, reopen the document from the library, and only then decide whether anything needs fixing.
>
> **Ve zkratce.** Po změně `Title` nebo `Hidden` sloupce knihovny může Word na počítači dál ukazovat ve Vlastnostech interní název (i skrytý sloupec) a nahoře žlutý pruh „Document Updates Available“. Knihovna je přitom v pořádku: pole seznamu, pole typu obsahu i `FieldLinks` mají nové hodnoty a soubor stažený z knihovny už aktuální schéma obsahuje, i když byl naposledy uložený před změnou. Word ukazuje schéma kopie, kterou měl otevřenou nebo v mezipaměti. Zavři Word, otevři dokument znovu z knihovny a teprve pak řeš, jestli je co opravovat.

## Symptom

A process renames library columns from internal-looking names to friendly titles and sets one of them to `Hidden`, by updating the list fields over REST. Afterwards, a document opened in Word for Windows still shows, under File → Info → Properties → Show All Properties:

- the internal names instead of the new titles,
- the hidden column as a visible property,
- a yellow bar: *"Document Updates Available – when you save this document, it will be updated"*.

The natural suspicion is that updating the list field did not reach the library's content type (its `FieldLinks`), and that the provisioning code needs to patch content types too.

## What the server actually holds

Measure before you change provisioning. On the library (`GetList(@l)` with the library's server-relative URL):

```http
GET /_api/web/GetList(@l)/contenttypes?@l='<library>'&$select=Name,StringId,SchemaXml
GET /_api/web/GetList(@l)/contenttypes('<ctId>')/fieldlinks?@l='<library>'&$select=Name,Hidden
GET /_api/web/GetList(@l)/contenttypes('<ctId>')/fields?@l='<library>'&$select=InternalName,Title,Hidden
```

In the case behind this article, all three already had the new titles, and `Hidden=true` on the field link of the hidden column.

Then download the document itself (`GetFileByServerRelativePath(decodedurl='…')/$value`) and unzip it. `customXml/item*.xml` holds the content type schema (`<ct:contentTypeSchema …>`). It already had the new `ma:displayName` values and `ma:hidden="true"`, although the file's `TimeLastModified` was **before** the rename. So the schema a client receives follows the current content type; it is not frozen at the last save.

## Cause

Word for Windows shows the properties from the schema in the copy it has open (or cached), and that copy predates the change. Closing Word completely and opening the document from the library again showed the new titles and no hidden column. The yellow bar says the document will be updated when you save it.

## Rules

1. **Measure the server first.** List field, content type field, `FieldLinks` and `SchemaXml`, plus the downloaded file's `customXml`. That last one is exactly what Word receives.
2. **Verify in Word on a fresh open.** Close Word completely, then open the document from the library again.
3. **Don't "fix" content types on a stale reading.** If the measurements show the new values, updating the list fields was enough, and patching `FieldLinks` in provisioning adds code for a problem that is not there.
