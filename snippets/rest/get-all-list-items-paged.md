---
title: Read all items from a large list — paging done right
tags: [rest-api, lists, paging]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-15
---

# Read all items from a large list — paging done right

**When to reach for it:** any list that can grow past a few thousand items. One call won't do — `$top` caps at 5,000 per page, and **`$skip` does not work on list items at all** (it's silently ignored). The only correct way is to follow the server's continuation link.

```ts
async function getAllItems<T>(spHttpClient: SPHttpClient, webUrl: string, listUrl: string, select: string, filter?: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined =
    `${webUrl}/_api/web/GetList(@u)/items?@u='${listUrl}'` +
    `&$select=${select}&$top=5000` +
    (filter ? `&$filter=${filter}` : '');

  while (next) {
    const res = await spHttpClient.get(next, SPHttpClient.configurations.v1, {
      headers: { 'Accept': 'application/json;odata=nometadata' }
    });
    if (!res.ok) { throw new Error(`getAllItems failed: HTTP ${res.status}`); }
    const data = await res.json();
    items.push(...(data.value as T[]));
    next = data['odata.nextLink'];   // absent on the last page
  }
  return items;
}
```

Key points:

- **`odata.nextLink`** carries an opaque `$skiptoken` — always follow it verbatim, never build your own.
- In `odata=verbose` mode the continuation link lives at **`d.__next`** instead, and rows at `d.results`.
- On lists over 5,000 items, the `$filter` must hit an **indexed column first**, or the whole query throws — see [the view threshold gotcha](../../gotchas/lists/list-view-threshold-and-indexes.md).
- Sanitize any dynamic values in `$filter` — [apostrophes double](../../gotchas/rest-api/odata-string-literals-and-apostrophes.md).
- Fetching *everything* client-side is a smell above ~20k items — consider search-based queries or server-side aggregation instead.
