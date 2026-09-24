---
title: Drop __metadata from write bodies — odata=verbose needs OData v3, and SPHttpClient sends v4
short-title: Drop `__metadata` from write bodies
summary: "Old-tutorial payloads 400 as plain JSON, and switching to `odata=verbose` 400s again under `SPHttpClient`, which sends `odata-version: 4.0`; write plain JSON without the type hint, or blank `odata-version` where the verbose form is really needed"
tags: [rest-api, odata, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-24
---

# Drop `__metadata` from write bodies — `odata=verbose` needs OData v3, and `SPHttpClient` sends v4

> **Bottom line.** A body carrying `__metadata` fails as plain JSON (HTTP 400, "the property '__metadata' does not exist"), and the classic fix — switch `Accept` and `Content-Type` to `odata=verbose` — works only when the request does not declare OData v4. `SPHttpClient` sends `odata-version: 4.0` by default, so the verbose body 400s again. For ordinary item and list writes, drop the hint and send plain JSON; SharePoint takes the type from the URL you write to. If an endpoint really needs the verbose form, blank the header (`'odata-version': ''`) to put `SPHttpClient` into OData v3 mode.
>
> **Ve zkratce.** Tělo s `__metadata` jako prostý JSON selže (HTTP 400, „the property '__metadata' does not exist“) a klasická oprava – přepnout `Accept` i `Content-Type` na `odata=verbose` – funguje jen u požadavku, který nehlásí OData v4. `SPHttpClient` ve výchozím stavu posílá `odata-version: 4.0`, takže verbose tělo skončí na 400 znovu. U běžných zápisů položek a seznamů typovou nápovědu vynech a pošli prostý JSON; typ si SharePoint vezme z adresy, na kterou zapisuješ. Když endpoint verbose tvar opravdu potřebuje, hlavičku vyprázdni (`'odata-version': ''`) – tím `SPHttpClient` přejde do režimu OData v3.

## Symptom

A POST or MERGE copied from an older tutorial carries a type hint:

```json
{ "__metadata": { "type": "SP.Data.TasksListItem" }, "Title": "Hello" }
```

Sent as plain JSON, it fails with **HTTP 400**:

```
InvalidClientQueryException: The property '__metadata' does not exist on type 'SP.Data.TasksListItem'.
```

The usual fix — make both headers `odata=verbose` — then fails again inside SPFx, with a different message:

```
HTTP 400: Parsing JSON Light feeds or entries in requests without entity set is not supported.
```

## Cause

`__metadata` exists only in the OData **verbose** wire format. In a plain-JSON request SharePoint reads it as an unknown property of your item — the first 400.

`SPHttpClient.configurations.v1` adds the request header `odata-version: 4.0`. A verbose body under that header is parsed as OData v4 JSON Light and rejected — the second 400. It does not depend on the list, its age or the entity type name. Verified live, twice, with an A/B on an item POST and on a list MERGE: the identical verbose body returns **201/204** through a bare `fetch` and **400** as soon as `odata-version: 4.0` is present; the same write without `__metadata` returns **201/204** either way.

## Fix

Drop `__metadata`. For ordinary item and list writes the hint is not needed — SharePoint infers the type from the URL:

```ts
headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
body: JSON.stringify({ Title: 'Hello' })
```

When an endpoint does need the verbose form, switch the client to OData v3 for that call — Microsoft documents that an empty `odata-version` header does exactly that:

```ts
headers: {
  'Accept': 'application/json;odata=verbose',
  'Content-Type': 'application/json;odata=verbose',
  'odata-version': ''                      // SPHttpClient now speaks OData v3
},
body: JSON.stringify({ __metadata: { type: 'SP.Data.TasksListItem' }, Title: 'Hello' })
```

- If a codebase mixes both styles, search the write paths for `__metadata` and `odata=verbose`: every hit that does not also blank `odata-version` is a latent 400 under `SPHttpClient`.
- **Blank `odata-version` only together with explicit `Accept` and `Content-Type`**, as above. With the version unknown, SPFx cannot fill in a default for a missing header and throws before sending — typically on a binary upload without `Content-Type` ([File upload via `/Files/add`](file-upload-406-needs-verbose.md)).
- Some writes carry a type in the OData v4 form instead — a MERGE that changes a field's `Choices` sends `'@odata.type': '#SP.FieldChoice'` in a plain JSON body ([Provisioning skips schema changes to existing fields](provisioning-skips-schema-changes-to-existing-fields.md)). Whether such an annotation is accepted depends on `OData-Version`, not on `Content-Type`: with `4.0` it passes under both `application/json` and `…;odata=nometadata`; without it the server answers 400 *"'@odata.type' is an invalid instance annotation name"* (live A/B, 2026-09-24). From a bare `fetch`, which speaks OData v3, the same body needs `__metadata` instead ([example](../search/nocrawl-on-a-library-silently-blinds-your-rag.md)); for views, simply leave the annotation out ([`POST /views` takes an `SP.View` body](creating-a-view-posts-sp-view-not-viewcreationinformation.md)).

## Notes

- **Include `odata-version: 4.0` when you A/B-test a write.** A bare `fetch` without it lets the verbose body through (201/204) and gives a false "it works"; if your test passes while the app still 400s, you tested `fetch`, not the client your code uses.
- The same v4 default explains a neighbouring error: in OData v4 mode the `Accept` directive is `odata.metadata=…`, and Microsoft notes that the old `odata=…` form can fail with *"The HTTP header ACCEPT is missing or its value is invalid"*. On `POST …/items` it did not fail in our test (2026-09-24): with `OData-Version: 4.0` SharePoint silently ignored `odata=nometadata` — and `odata=verbose` — in `Accept` and answered `odata.metadata=minimal`, so a parser waiting for `d` finds nothing there.
- Mixed symptoms of the same class: verbose *response* shapes are nested under `d` (`data.d.results` vs `data.value`) — check which mode you are in before parsing.
- [Connect to SharePoint APIs — OData v4.0](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/connect-to-sharepoint#odata-v40) (Microsoft)
