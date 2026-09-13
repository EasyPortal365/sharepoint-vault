---
title: "`POST /views` takes an `SP.View` body — `ViewTypeKind` and `@odata.type` both fail"
tags: [rest-api, lists, views, spfx, odata, nometadata]
applies-to: SharePoint Online REST (`odata=nometadata`, tested from SPFx `SPHttpClient`)
last-reviewed: 2026-09-13
---

# `POST /views` takes an `SP.View` body — `ViewTypeKind` and `@odata.type` both fail

> **Bottom line.** Creating a list view with `odata=nometadata` sends a body that SharePoint reads as **`SP.View`**, not `SP.ViewCreationInformation`. `ViewTypeKind` — the property the creation-information docs tell you to send — does not exist on `SP.View` and returns HTTP 400. Adding `@odata.type` to say otherwise fails too: nometadata rejects any type annotation inside the body, on create *and* on MERGE. Send a plain body with no annotation and no `ViewTypeKind`.
>
> **Ve zkratce.** Založení pohledu přes `odata=nometadata` posílá tělo, které SharePoint čte jako **`SP.View`**, ne jako `SP.ViewCreationInformation`. `ViewTypeKind` z dokumentace k creation-information na `SP.View` neexistuje a vrátí HTTP 400. Doplnit `@odata.type` nepomůže — nometadata anotaci typu v těle odmítne, a to jak při zakládání, tak při MERGE. Posílá se prosté tělo bez anotace a bez `ViewTypeKind`.

## Symptom

You build the request from the `SP.ViewCreationInformation` documentation and get a 400 that names a *different* type than the one you were writing against:

```
The property 'ViewTypeKind' does not exist on type 'SP.View'.
Make sure to only use property names that are defined by the type.
```

The natural next move — declaring the type explicitly — produces a second 400:

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

The `@odata.type` half is worse, because it is the standard remedy for exactly this class of problem in `odata=verbose` and it is documented advice in several places. In `nometadata` it is not merely unnecessary — the parser refuses the request outright.

## Rule

**Measure the body shape of a SharePoint REST write; don't copy it** — not from documentation, and not from your own earlier notes. A two-minute probe against a real list with a throwaway view (delete it afterwards) tells you what the server accepts, and the answer is visible in the error text immediately. Where a measurement contradicts something you have written down before, record the contradiction as well as the new recipe — otherwise the next person re-derives it from the same stale note.

## Related

- [Gallery cards render from `tileProps`, not from `formatter`](../lists/gallery-cards-render-from-tileprops.md) — the other half of view manipulation over REST, including the two-call rule for layout plus formatter.
- [View formatting lands on the wrong view](../lists/view-formatting-lands-on-the-wrong-view.md)
