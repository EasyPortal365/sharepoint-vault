---
title: "File upload via /Files/add: nometadata works under OData v4 — an empty OData-Version breaks SPFx when you leave out Content-Type"
tags: [rest-api, files, upload, spfx, odata, mobile]
applies-to: SharePoint Online, SPFx SPHttpClient (checked against @microsoft/sp-http-base 1.22.2)
last-reviewed: 2026-09-24
---

# File upload via `/Files/add`: nometadata works under OData v4 — an empty `OData-Version` breaks SPFx when you leave out `Content-Type`

> **Bottom line.** Upload through `SPHttpClient` with `Accept: application/json;odata=nometadata` (or plain `application/json`) and `Content-Type: application/octet-stream`, and let SPFx send its default `OData-Version: 4.0`. The real trap is on the client: an empty `OData-Version` header makes `SPHttpClient` throw *before* the request is sent whenever it would have to add a default `Content-Type` or `Accept` itself — and a binary upload usually has no `Content-Type`.
>
> **Ve zkratce.** Nahrávej přes `SPHttpClient` s `Accept: application/json;odata=nometadata` (nebo prostým `application/json`) a `Content-Type: application/octet-stream` a výchozí `OData-Version: 4.0` nech na SPFx. Skutečná past je na klientovi: s prázdnou hlavičkou `OData-Version` `SPHttpClient` vyhodí chybu ještě před odesláním, kdykoli by sám musel doplnit výchozí `Content-Type` nebo `Accept` – a binární upload `Content-Type` obvykle nemá.

> **Correction (2026-09-24).** The first version of this article (the file name still says so, to keep existing links working) claimed that `/Files/add` rejects `odata=nometadata` with HTTP 406 and needs `odata=verbose` plus `OData-Version: 3.0`, and that an empty `OData-Version` is always refused by SPFx. Neither holds as stated: shipped upload code sends `nometadata` under OData v4, and the empty-header refusal happens only when `Content-Type` or `Accept` is missing — measured by running SPFx's own header logic, below.

## Symptom

You pass `'odata-version': ''` to switch `SPHttpClient` into OData v3 mode for an upload, and the call fails **without any request in the network tab**. The console shows an exception thrown by SPFx itself:

```
Error: ISPHttpClientConfiguration.jsonRequest is enabled, which requires the "OData-Version" header to be 3.0 or 4.0
```

(or the same sentence with `jsonResponse` when the request has no `Accept`). The same empty header works elsewhere in your code — on JSON writes — which makes it look random.

## Cause

`SPHttpClient.configurations.v1` has `jsonRequest: true`, `jsonResponse: true` and `defaultODataVersion: 4.0`. In `@microsoft/sp-http-base` (`SPHttpClientHelper`), a request goes through three steps:

1. The default `OData-Version: 4.0` is added **only if the header is absent**. An empty string counts as present, so nothing is added.
2. The version is parsed from the headers. An empty value parses as *unknown*, without an error.
3. Defaults are filled in: for a non-GET request **without `Content-Type`** SPFx picks a JSON content type for the known version, and for a request **without `Accept`** it picks an `Accept`. With an unknown version it cannot pick — and throws the error above.

So an empty `OData-Version` is legitimate only when you set both `Accept` and (for writes) `Content-Type` yourself. JSON writes usually do; a binary upload usually sets only `Accept`. Running that exact logic over real header sets gives:

| Headers you pass | What SPFx does |
|---|---|
| `Accept: …;odata=verbose`, `'odata-version': ''`, no `Content-Type` | **throws** (`jsonRequest`) — the request never leaves the browser |
| `Accept` and `Content-Type` both set, `'odata-version': ''` | sends as is — OData v3 mode works |
| `'odata-version': ''` and `Content-Type`, no `Accept` | **throws** (`jsonResponse`) |
| `Accept: …;odata=nometadata`, nothing else | adds `OData-Version: 4.0` and `Content-Type: application/json;charset=utf-8` |
| `Accept: …;odata=verbose`, `OData-Version: 3.0` | adds `Content-Type: application/json;odata=verbose;charset=utf-8` |

## Fix

```ts
const res = await spHttpClient.post(
  `${webUrl}/_api/web/GetFolderByServerRelativeUrl('${folder.replace(/'/g, "''")}')/Files/add(url='${safeName.replace(/'/g, "''")}',overwrite=true)?$expand=ListItemAllFields`,
  SPHttpClient.configurations.v1,
  {
    headers: {
      'Accept': 'application/json;odata=nometadata',
      'Content-Type': 'application/octet-stream'
    },
    body: arrayBuffer
  }
);
if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status} ${await res.text()}`);
const created = await res.json();
const itemId = created.ListItemAllFields && created.ListItemAllFields.Id;   // nometadata under v4: top level
```

- Under OData v4 SharePoint ignores the `odata=nometadata` directive in `Accept` and answers with *minimal* metadata; the properties you need are at the top level. In verbose mode the same id is at `data.d.ListItemAllFields.Id`.
- If you do need verbose for an upload, it works too — `Accept: …;odata=verbose` with `OData-Version: 3.0` — but then read the verbose shape.
- Without an explicit `Content-Type`, SPFx labels your binary body as JSON (see the table). Shipped upload paths rely on that default, but say what you send.

## Notes

- **Where did the 406 come from?** Not re-measured. Across one code base, shipped upload paths send `nometadata` or plain `application/json` under OData v4 (document libraries and list attachments alike), others send verbose with `OData-Version: 3.0` — so the 406 does not follow from `nometadata` alone. If you get *"The HTTP header ACCEPT is missing or its value is invalid"*, log the full request headers — including `OData-Version` — before blaming `nometadata`.
- **Mobile cameras can hand you `File.name === ''`** (or a name without an extension) — the upload then fails on the empty `url=''`. Build a fallback name from the MIME type and add a collision-proof prefix:

  ```ts
  const fallback = file.type.indexOf('image/') === 0
    ? 'photo.' + file.type.split('/')[1].replace('jpeg', 'jpg')
    : 'upload.bin';
  const original = file.name && file.name.trim() ? file.name : fallback;
  const safeName = `${Date.now()}-${original}`;
  ```

- Apostrophes in file names break the OData literal — `encodeURIComponent` does **not** encode `'`; double it (`'` → `''`) before building the URL.
- On failure, always log the response body (`await res.text()`), not just the status — SharePoint's message usually names the real problem (permissions, required fields, path). A client-side throw has no response at all: catch it and show its message.
- Related: [Drop `__metadata` from write bodies](metadata-body-requires-verbose.md) — where the empty `odata-version` is the right tool, because both headers are set.
