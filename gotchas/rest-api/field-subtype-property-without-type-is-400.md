---
title: POST /fields rejects a subtype property like RichText unless the body names the subtype
summary: "{ FieldTypeKind: 3, RichText: false } without @odata.type is read as SP.Field and fails with 400 – plain text columns in the same loop succeed, so the list ends up half-built; use CreateFieldAsXml or annotate the type"
tags: [rest-api, fields, provisioning, lists]
applies-to: SharePoint Online
last-reviewed: 2026-10-28
---

# POST /fields rejects a subtype property like RichText unless the body names the subtype

> **Bottom line.** A `POST …/fields` body is deserialised as the base type `SP.Field` unless it says otherwise. `FieldTypeKind: 3` does not change that, so a property that only exists on the subtype – `RichText`, `NumberOfLines`, `Choices` – fails with 400. Create the column with `CreateFieldAsXml`, or add `'@odata.type': '#SP.FieldMultiLineText'` (OData v4 client). Check every column after a loop of creates: the text columns go through and the list is left half-built.
>
> **Ve zkratce.** Tělo `POST …/fields` se čte jako základní typ `SP.Field`, pokud neřekne jinak. `FieldTypeKind: 3` na tom nic nemění, takže vlastnost, která existuje až u podtypu – `RichText`, `NumberOfLines`, `Choices` – skončí chybou 400. Sloupec založ přes `CreateFieldAsXml`, nebo přidej `'@odata.type': '#SP.FieldMultiLineText'` (klient OData v4). Po smyčce zakládání ověř všechny sloupce: textové projdou a seznam zůstane napůl založený.

## Symptom

A hidden log list is created on first use, then its columns are added in a loop. The list exists afterwards, but only the single-line text columns are there; the first write to a multi-line column fails because the column is missing.

The failing request:

```http
POST /_api/web/lists(guid'…')/fields
Accept: application/json;odata=nometadata
Content-Type: application/json;odata=nometadata

{ "Title": "Detail", "FieldTypeKind": 3, "RichText": false }
```

```text
400 Microsoft.SharePoint.Client.InvalidClientQueryException:
The property 'RichText' does not exist on type 'SP.Field'.
Make sure to only use property names that are defined by the type.
```

## Why

The `fields` collection accepts any field kind, so the entity set's type is `SP.Field`. `FieldTypeKind` is just a property of that type; it does not select a derived type for deserialisation. Without a type annotation the server validates the body against `SP.Field`, which has no `RichText`.

Single-line text columns usually carry nothing but `Title` and `FieldTypeKind`, so they pass and hide the problem.

## Fix

`CreateFieldAsXml` takes the schema as XML and works with a plain `nometadata` body (measured live, 200, column created with `RichText = false`):

```ts
await fetch(`${listApi}/fields/CreateFieldAsXml`, {
  method: 'POST',
  headers: { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata', 'X-RequestDigest': digest },
  body: JSON.stringify({ parameters: {
    SchemaXml: '<Field Type="Note" Name="Detail" StaticName="Detail" DisplayName="Detail" RichText="FALSE" NumLines="6" />',
    Options: 0
  } })
});
```

Alternatively, name the subtype in the body. With an OData v4 client (SPFx `SPHttpClient` sends `OData-Version: 4.0`) that is `'@odata.type': '#SP.FieldMultiLineText'`; from a bare `fetch` (OData v3) it needs `__metadata` and `odata=verbose` instead – see [`__metadata` in the body requires verbose](metadata-body-requires-verbose.md).

## Prevention

- After a create loop, read the list's fields back and fail loudly if any is missing, instead of discovering it on the first write.
- Run the first-use path once on a clean test site before release: a list that already has the columns never exercises it.
