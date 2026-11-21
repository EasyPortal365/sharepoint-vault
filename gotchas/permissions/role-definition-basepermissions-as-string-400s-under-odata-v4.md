---
title: "Creating a role definition from `SPHttpClient`: `BasePermissions` as strings returns 400 `Edm.Int64`"
short-title: "`BasePermissions` as strings 400s under OData v4"
summary: "Under `OData-Version: 4.0` (the SPHttpClient default) `High`/`Low` must be numbers, or the Content-Type must carry `IEEE754Compatible=true`; measured A/B on POST /roledefinitions"
tags: [rest-api, permissions, spfx, odata, nometadata, role-definitions]
applies-to: SharePoint Online REST, `POST /_api/web/roledefinitions` from SPFx `SPHttpClient` (`odata=nometadata`)
last-reviewed: 2026-11-21
---

# Creating a role definition from `SPHttpClient`: `BasePermissions` as strings returns 400 `Edm.Int64`

> **Bottom line.** `SPHttpClient` sends `OData-Version: 4.0`. In OData v4 an `Edm.Int64` is written as a JSON **number**; SharePoint accepts a string only when the `Content-Type` carries `IEEE754Compatible=true`. Older `odata=verbose` samples send `High`/`Low` as strings — copy one into an SPFx call and every role definition fails with HTTP 400. Send the masks as numbers (they are 32-bit, safe in JS).
>
> **Ve zkratce.** `SPHttpClient` posílá `OData-Version: 4.0`. V OData v4 se `Edm.Int64` píše jako JSON **číslo**; řetězec SharePoint přijme jen s `IEEE754Compatible=true` v `Content-Type`. Starší příklady pro `odata=verbose` posílají `High`/`Low` řetězcem – přenesené do SPFx skončí každé založení úrovně na HTTP 400. Masky posílej čísly (jsou 32bitové, v JS bezpečné).

## Symptom

```
POST /_api/web/roledefinitions  →  400
Cannot convert a value to target type 'Edm.Int64' because of conflict between
input format string/number and parameter 'IEEE754Compatible' false/true.
```

with a body like:

```json
{ "Name": "Add only", "Description": "…", "Order": 250,
  "BasePermissions": { "High": "48", "Low": "65538" } }
```

## Measured (bare `fetch`, same string body, site owner)

| Headers | Result |
|---|---|
| no `OData-Version` | 201 |
| `OData-Version: 4.0` | **400** (error above) |
| `OData-Version: 4.0` + `Content-Type: application/json;odata=nometadata;IEEE754Compatible=true` | 201 |
| `OData-Version: 4.0` + numbers instead of strings | 201 |

Because `SPHttpClient` always adds `OData-Version: 4.0`, the string body fails from SPFx even though the same body works from PowerShell or a plain `fetch`.

## Fix

```ts
const body = {
  '@odata.type': '#SP.RoleDefinition',
  Name: name, Description: description, Order: 250,
  BasePermissions: { '@odata.type': '#SP.BasePermissions', High: Number(high), Low: Number(low) }
};
```

- Keep the body in one small, tested function and assert `typeof High === 'number'` — the bug is invisible to the type checker when the values come through `String(...)`.
- If you genuinely need a string (a true 64-bit value), add `IEEE754Compatible=true` to the `Content-Type` instead.
- Clean up any test role definitions you created while probing (`DELETE /_api/web/roledefinitions/getbyname('<name>')`).

## Related

- [`POST /views` takes an `SP.View` body](../rest-api/creating-a-view-posts-sp-view-not-viewcreationinformation.md) — the same `OData-Version` header decides whether `@odata.type` is accepted.
