---
title: Search REST API needs odata-version 3.0
tags: [rest-api, search, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
---

# Search REST API needs `odata-version: 3.0`

## Symptom

Calls to `/_api/search/query` fail with an unhelpful **500 Internal Server Error** — typically from SPFx (`SPHttpClient`) or another modern HTTP client, while the very same query works when pasted into the browser's address bar.

## Cause

The search endpoint still speaks **OData 3.0**. Modern clients — SPFx `SPHttpClient` in particular — send `odata-version: 4.0` by default, and the search service fails hard on it instead of degrading gracefully.

## Fix

Send the header explicitly on every `/_api/search/*` call:

```ts
const res = await this.context.spHttpClient.get(
  `${webUrl}/_api/search/query?querytext='${encodeURIComponent(query)}'`,
  SPHttpClient.configurations.v1,
  {
    headers: {
      'odata-version': '3.0',
      'Accept': 'application/json;odata=nometadata'
    }
  }
);
```

Plain `fetch` or any other client: same idea — add `odata-version: 3.0`.

## Notes

- `POST /_api/search/postquery` needs the same header.
- Diagnostic shortcut: if search calls 500 while the rest of `/_api` works fine, check this header first — it is almost always the answer.
