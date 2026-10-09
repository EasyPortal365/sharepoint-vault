---
title: The ETag key is `@odata.etag` in OData v4 – reading `odata.etag` silently turns IF-MATCH into `*`
short-title: ETag key is `@odata.etag`
summary: "SPHttpClient speaks OData v4: the item ETag comes as `@odata.etag`; reading `odata.etag` yields undefined and your IF-MATCH protection quietly disappears"
tags: [rest-api, spfx, concurrency, etag]
applies-to: SharePoint Online, SPFx
last-reviewed: 2026-10-09
---

# The ETag key is `@odata.etag` in OData v4 – reading `odata.etag` silently turns IF-MATCH into `*`

> **Bottom line.** With SPFx `SPHttpClient` (which sends `odata-version: 4.0`) a list item comes back with the key **`@odata.etag`** – with `Accept: application/json` and with `;odata=nometadata` alike. Code that reads `item['odata.etag']` (the OData v3 shape) gets `undefined`, typically falls back to `IF-MATCH: *`, and optimistic concurrency is gone without a single error. Read the ETag through one helper that accepts both keys.
>
> **Ve zkratce.** S `SPHttpClient` (posílá `odata-version: 4.0`) přijde položka s klíčem **`@odata.etag`** – s `Accept: application/json` i s `;odata=nometadata`. Kód, který čte `item['odata.etag']` (tvar OData v3), dostane `undefined`, obvykle pošle `IF-MATCH: *` a ochrana proti souběžné úpravě zmizí bez jediné chyby. ETag čti jedním helperem, který zná oba klíče.

## Symptom

Two people edit the same item at nearly the same time and one change silently disappears. Your code *does* pass an ETag to the update – but you never see a 412, not even in a deliberate test with two browser tabs.

```ts
// Looks right, never protects anything under SPHttpClient:
const etag = (item as { 'odata.etag'?: string })['odata.etag'];   // undefined
await update(id, patch, etag);                                     // → IF-MATCH: *
```

## Cause

`SPHttpClient.configurations.v1` sets `defaultODataVersion = ODataVersion.v4`, so every request carries `OData-Version: 4.0` ([ISPHttpClientConfigurations](https://learn.microsoft.com/javascript/api/sp-http-base/isphttpclientconfigurations?view=sp-typescript-latest)). In v4 the control information is prefixed with `@`: a list item response contains `@odata.type`, `@odata.id`, `@odata.etag` and `@odata.editLink` – verified on SharePoint Online with both `Accept: application/json` and `Accept: application/json;odata=nometadata`.

Without an `OData-Version` header the server answers in v3 (Microsoft documents that it "currently defaults to Version 3.0 in most cases"), and then the key really is `odata.etag` – verified the same way, as is `__metadata.etag` with `odata=verbose`. That is why plain `fetch` samples use `odata.etag`: the code is right for `fetch`, wrong for `SPHttpClient`.

A common helper pattern sends `IF-MATCH: *` when it has no ETag, and SharePoint then overwrites the item regardless of version ([Working with lists and list items with REST](https://learn.microsoft.com/sharepoint/dev/sp-add-ins/working-with-lists-and-list-items-with-rest#using-etag-values-to-determine-document-and-list-item-versioning)) – so the mistake never surfaces.

## Fix

Read the ETag in exactly one place and accept both shapes:

```ts
export function etagOf(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const o = item as { '@odata.etag'?: unknown; 'odata.etag'?: unknown };
  const tag = o['@odata.etag'] || o['odata.etag'];
  return typeof tag === 'string' && tag ? tag : undefined;
}
```

Then replace every hand-written `['odata.etag']` with it, and add a small unit test (including "no key → `undefined`").

## Notes

- Once the ETag really works, a second save of the same item from the same in-memory copy fails with **412** – your own successful write changed the item, so the ETag you hold no longer matches (SharePoint returns 412 on a mismatching `If-Match`, per the same Microsoft page). Re-read the item (or take the new ETag) after each write. See [Adding an attachment changes the item's ETag](./adding-an-attachment-changes-the-item-etag.md) for the same effect caused by attachments.
- Don't "fix" a 412 by switching to `IF-MATCH: *` – that removes the protection you just restored.
