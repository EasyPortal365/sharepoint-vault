---
title: File upload via /Files/add returns 406 unless you Accept odata=verbose
tags: [rest-api, files, upload, spfx, mobile]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
---

# File upload via `/Files/add` returns 406 unless you `Accept: odata=verbose`

## Symptom

Uploading a file:

```
POST /_api/web/GetFolderByServerRelativeUrl('Documents')/Files/add(url='report.pdf',overwrite=true)
```

fails with **HTTP 406**:

```json
{"error":{"code":"-1, Microsoft.SharePoint.Client.ClientServiceException",
  "message":"The HTTP header ACCEPT is missing or its value is invalid."}}
```

…while your other REST calls with `Accept: application/json;odata=nometadata` work fine.

## Cause

`/Files/add` is a **classic (OData 3) endpoint** that never learned the modern `nometadata` format. It insists on `odata=verbose`.

## Fix

Send verbose *and* the matching OData version:

```ts
const res = await spHttpClient.fetch(
  `${webUrl}/_api/web/GetFolderByServerRelativeUrl('Documents')/Files/add(url='${encodeURIComponent(safeName)}',overwrite=true)`,
  SPHttpClient.configurations.v1,
  {
    method: 'POST',
    headers: {
      'Accept': 'application/json;odata=verbose',
      'OData-Version': '3.0'
    },
    body: arrayBuffer
  }
);
```

Two sub-traps hiding in there:

1. **`OData-Version` must literally be `'3.0'` (or `'4.0'`).** Trying to "turn it off" with an empty string makes the SPFx client refuse the request client-side: *`ISPHttpClientConfiguration.jsonRequest is enabled, which requires the "OData-Version" header to be 3.0 or 4.0`*.
2. **The response is verbose-shaped** — the item id lives at `data.d.ListItemAllFields.Id`, not at the top level.

## Notes

- **Mobile cameras can hand you `File.name === ''`** (or a name without an extension) — the upload then fails on the empty `url=''`. Build a fallback name from the MIME type and add a collision-proof prefix:

  ```ts
  const fallback = file.type.indexOf('image/') === 0
    ? 'photo.' + file.type.split('/')[1].replace('jpeg', 'jpg')
    : 'upload.bin';
  const original = file.name && file.name.trim() ? file.name : fallback;
  const safeName = `${Date.now()}-${original}`;
  ```

- Apostrophes in file names break the OData literal — `encodeURIComponent` does **not** encode `'`; double it (`'` → `''`) before building the URL.
- On failure, always log the response body (`await res.text()`), not just the status — SharePoint's message usually names the real problem (permissions, required fields, path).
