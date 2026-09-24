---
title: "`POST /views` takes an `SP.View` body — `ViewTypeKind` fails, and `@odata.type` passes only under OData v4"
tags: [rest-api, lists, views, spfx, odata, nometadata]
applies-to: SharePoint Online REST (`odata=nometadata`, tested from SPFx `SPHttpClient` and from a bare `fetch`)
last-reviewed: 2026-09-24
---

# `POST /views` takes an `SP.View` body — `ViewTypeKind` fails, and `@odata.type` passes only under OData v4

> **Bottom line.** Creating a list view with `odata=nometadata` sends a body that SharePoint reads as **`SP.View`**, not `SP.ViewCreationInformation`. `ViewTypeKind` — the property the creation-information docs tell you to send — does not exist on `SP.View` and returns HTTP 400. An `@odata.type` annotation in the body is accepted only when the request carries `OData-Version: 4.0` (which `SPHttpClient` sends by default); a bare `fetch` without that header gets a second 400. Simplest recipe: a plain body with no annotation and no `ViewTypeKind`.
>
> **Ve zkratce.** Založení pohledu přes `odata=nometadata` posílá tělo, které SharePoint čte jako **`SP.View`**, ne jako `SP.ViewCreationInformation`. `ViewTypeKind` z dokumentace k creation-information na `SP.View` neexistuje a vrátí HTTP 400. Anotaci `@odata.type` v těle SharePoint přijme jen s hlavičkou `OData-Version: 4.0` (tu `SPHttpClient` posílá sám); holý `fetch` bez ní dostane druhou 400. Nejjednodušší je prosté tělo bez anotace a bez `ViewTypeKind`.

> **Correction (2026-09-24).** Earlier versions said nometadata rejects any type annotation, and then that the `Content-Type` decides. A live A/B test settled it: the switch is the `OData-Version` header. With `4.0`, `'@odata.type'` passed under both `Content-Type: application/json` and `…;odata=nometadata` — MERGE of an item 204, MERGE of a list 204, `POST` of a view 201, `POST` of a field 201, each confirmed by reading back. Without the header it failed under both content types. The original 400s were most likely produced by a probe that did not send the header.

## Symptom

You build the request from the `SP.ViewCreationInformation` documentation and get a 400 that names a *different* type than the one you were writing against:

```
The property 'ViewTypeKind' does not exist on type 'SP.View'.
Make sure to only use property names that are defined by the type.
```

The natural next move — declaring the type explicitly — can produce a second 400, depending on the headers:

```
'@odata.type' is an invalid instance annotation name.
```

Both failures come back **before** anything is created, so nothing is half-written; but neither is visible to a compiler or a linter, because the body is just an object literal.

## What actually works

Measured against a live document library, then verified by reading the view back:

```http
POST /_api/web/GetList('<server-relative-list-url>')/views
Accept: application/json;odata=nometadata
Content-Type: application/json;odata=nometadata

{ "Title": "By modified", "ViewQuery": "<OrderBy><FieldRef Name=\"Modified\" Ascending=\"FALSE\"/></OrderBy>",
  "RowLimit": 50, "Paged": true, "PersonalView": false }
```

`Scope` (folder recursion) is **not** accepted at creation — it needs a second call, again with no type annotation:

```http
POST /_api/web/GetList('<list>')/views('<id>')
X-HTTP-Method: MERGE
IF-MATCH: *

{ "Scope": 1 }
```

View fields go last, in two steps, and **neither request may carry a body** — an empty JSON body with a `Content-Type` is rejected by some farms:

```http
POST /_api/web/GetList('<list>')/views('<id>')/viewfields/removeallviewfields
POST /_api/web/GetList('<list>')/views('<id>')/viewfields/addviewfield('<InternalName>')   ← once per column, in order
```

`removeallviewfields` first is not optional: `addviewfield` is **not** idempotent and a second run duplicates the column.

After this sequence a read-back returns `Scope`, `RowLimit`, `Paged`, `ViewQuery` and the column **order** exactly as sent.

### `Scope` values

| Value | Meaning |
|---|---|
| `0` | default — current folder only |
| `1` | recursive — items from all folders |
| `2` | recursive, folders included |
| `3` | files only |

On a library with a folder tree this is the setting that decides what the view shows; the same column list at scope `0` and scope `1` looks like two different views.

## Why it bites

The creation-information type is what the documentation describes, so the body gets written against it — and the endpoint quietly parses it as the entity type instead. The error text names `SP.View`, which reads like a typo rather than a signal that the whole payload shape was interpreted differently.

The `@odata.type` half bites in testing more than in production. `SPHttpClient` adds `OData-Version: 4.0` to every request, so an annotated body written through it passes. A quick probe with `fetch` in the browser console sends no version header — and the same body fails. If you verify a write shape with a bare `fetch`, send the headers your production client sends, `OData-Version` included; otherwise you measure a different request (the verbose `__metadata` body shows the same effect in reverse: [Drop `__metadata` from write bodies](metadata-body-requires-verbose.md)).

## Rule

**Measure the body shape of a SharePoint REST write; don't copy it** — not from documentation, and not from your own earlier notes. A two-minute probe against a real list with a throwaway view (delete it afterwards) tells you what the server accepts, and the answer is visible in the error text immediately. Probe with the same headers your code sends. Where a measurement contradicts something you have written down before, record the contradiction as well as the new recipe — otherwise the next person re-derives it from the same stale note.

## Related

- [Gallery cards render from `tileProps`, not from `formatter`](../lists/gallery-cards-render-from-tileprops.md) — the other half of view manipulation over REST, including the two-call rule for layout plus formatter.
- [View formatting lands on the wrong view](../lists/view-formatting-lands-on-the-wrong-view.md)
