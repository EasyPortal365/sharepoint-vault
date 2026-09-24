---
title: "`AddValidateUpdateItemUsingPath` answers 200 when it creates nothing — while a write to a missing column is a loud 400"
short-title: "`AddValidateUpdateItemUsingPath` answers 200 when it creates nothing"
summary: Field errors sit inside a 200 and no item is created; a write to a missing column is a 400 on every path, never a silent drop
tags: [rest-api, lists, validation, error-handling, provisioning]
applies-to: SharePoint Online REST
last-reviewed: 2026-09-24
---

# `AddValidateUpdateItemUsingPath` answers 200 when it creates nothing — while a write to a missing column is a loud 400

> **Bottom line.** The validate endpoints report field errors *inside* a 200 response: `AddValidateUpdateItemUsingPath` with an invalid value (text in a Number column) returns HTTP 200 with `HasException: true` on that field — and **no item is created**. Read success from the body, field by field, never from the status. The opposite case is loud: a write to a column that does not exist (yet) fails with 400 on every write path — nothing is dropped silently.
>
> **Ve zkratce.** Validační endpointy hlásí chyby polí *uvnitř* odpovědi 200: `AddValidateUpdateItemUsingPath` s neplatnou hodnotou (text do číselného sloupce) vrátí HTTP 200 s `HasException: true` u pole – a **položka nevznikne**. Úspěch čti z těla, pole po poli, nikdy ze statusu. Opačný případ je hlasitý: zápis do sloupce, který (ještě) neexistuje, skončí 400 na každé zápisové cestě – nic se tiše nezahodí.

## Symptom

Two traps that point in opposite directions, both measured live (SharePoint Online, 2026-09-24, throwaway lists, cleaned up afterwards):

1. **The quiet one.** An import creates items through `AddValidateUpdateItemUsingPath` — the endpoint that applies the same validation as SharePoint's forms. One row carries `"abc"` for a Number column. The call returns **HTTP 200**; the code counts it as created. The item does not exist.
2. **The loud one.** A seed runs right after a release that adds a new column, before provisioning has created it. You may have read that SharePoint silently drops unknown Text properties. It does not: every write fails.

| Write | Target column | Result |
|---|---|---|
| `POST …/items`, `MERGE` — any header combination | does not exist (text, number, yes/no or multi-value) | **400** *"The property '…' does not exist on type '…'"* |
| `AddValidateUpdateItemUsingPath` | does not exist | **400** |
| `AddValidateUpdateItemUsingPath` | exists (Number), value `"abc"` | **200**, the field reports `HasException: true`, **no item created** |

## Cause

`AddValidateUpdateItemUsingPath` and `ValidateUpdateListItem` validate each form value the way a SharePoint form does and return one result per field. A value the field rejects is a *validation result*, not a request failure, so the HTTP status stays 200 — even when the rejection means the item was never written. A property the list's entity type does not know is different: the request body cannot be bound at all, and that is a 400 before any validation happens.

## Fix

Check every field result of a validate call:

```ts
const res = await spHttpClient.post(
  `${webUrl}/_api/web/GetList('${listUrl}')/AddValidateUpdateItemUsingPath`,
  SPHttpClient.configurations.v1,
  {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      listItemCreateInfo: { FolderPath: { DecodedUrl: listUrl }, UnderlyingObjectType: 0 },
      formValues: [{ FieldName: 'Amount', FieldValue: value }],
      bNewDocumentUpdate: false
    })
  }
);
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
const results: Array<{ FieldName: string; HasException: boolean; ErrorMessage?: string }> = (await res.json()).value || [];
const failed = results.filter(r => r.HasException);
if (failed.length) throw new Error(failed.map(r => `${r.FieldName}: ${r.ErrorMessage}`).join('; '));   // nothing was written
```

And for plain `POST`/`MERGE` writes: never swallow the 400. If a seed reports success while a new column stays empty on every item, a 400 was caught and ignored somewhere — the platform did not drop the value for you.

## Notes

- After deploying a schema change, wait for provisioning to finish before seeding, or have the seed re-check the column (`GET …/fields/getbyinternalnameortitle('<name>')` — a missing field is a 400 there too, not a 404: [getbyinternalnameortitle returns 400](getbyinternalnameortitle-400-not-404.md)).
- The same "200 is not success" rule holds for `ValidateUpdateListItem` on existing items: [Created/Modified on a document library](../lists/created-modified-on-a-document-library.md).
- Validation does **not** cover Choice vocabularies — a value outside `Choices` is stored, 200/201 all the way: [Choice fields accept any value](choice-fields-accept-any-value.md).
