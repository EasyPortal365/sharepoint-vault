---
title: Read all items from a large list — paging done right
tags: [rest-api, lists, paging, error-handling]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-31
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

---

## Do not "soften" the error branch

The `throw` above looks unfriendly, and sooner or later someone replaces it with `break` so the
UI "degrades gracefully". That change is the bug. `break` leaves the loop with a **partial array
and no way for the caller to know it** — a 403 on page one returns `[]`, which is indistinguishable
from an empty list, and a failure on page three returns two thirds of the data looking complete.

Downstream this reads as fact: counts, exports, "nothing found", "all clear", "this user confirmed
nothing". Silent truncation is worse than an exception, because an exception is at least visible.

If the caller genuinely must not throw, return the **state alongside the data** rather than hiding it:

```ts
export interface PagedRead<T> {
  ok: boolean;        // false = the read failed. Never means "there is nothing there".
  items: T[];         // partial when ok === false
  truncated: boolean; // true = the list is NOT complete (hit the guard or the cap)
  status: number;     // 0 = exception (network/CORS)
}

export async function getAllItemsStrict<T>(
  spHttpClient: SPHttpClient, firstUrl: string, maxItems = 50000
): Promise<PagedRead<T>> {
  const items: T[] = [];
  let next: string | undefined = firstUrl;
  let guard = 0;
  try {
    while (next && items.length < maxItems && guard < 100) {
      const res = await spHttpClient.get(next, SPHttpClient.configurations.v1, {
        headers: { 'Accept': 'application/json;odata=nometadata' }
      });
      if (!res.ok) return { ok: false, items: items.slice(0, maxItems), truncated: true, status: res.status };
      const data = await res.json();
      items.push(...(data.value as T[]));
      next = data['odata.nextLink'];
      guard += 1;
    }
  } catch (e) {
    return { ok: false, items: items.slice(0, maxItems), truncated: true, status: 0 };
  }
  // `next` still set after the loop = a page was waiting but a cap stopped us.
  return { ok: true, items: items.slice(0, maxItems), truncated: !!next || items.length > maxItems, status: 200 };
}
```

Three things worth copying from that shape:

- **The runaway guard is not optional.** A malformed `nextLink` that points at itself turns a read
  into an infinite loop. Cap both the item count and the number of round trips.
- **`truncated` is a separate flag from `ok`.** A successful read can still be incomplete, and the
  two need different words on screen: "we couldn't read this" versus "this list is not all of it".
  A screen that shows neither turns a capped list into "that record doesn't exist".
- **Don't branch on the status code.** A list that does not exist returns **HTTP 500**, not 404, so
  status tells you what to *print*, never what to *do*. Branch on `res.ok`.

**If you keep a non-strict wrapper for convenience, make it re-throw** (`if (r.error) throw r.error`)
rather than returning `.items` unconditionally — otherwise the wrapper quietly reintroduces exactly
the hole the strict version was written to close.

## Caching: never cache a failure

Wherever this read sits behind a cache, only **successful** results may be stored. Cache a failed
read and a transient 403 becomes "this group is empty" for the whole TTL — including after the
permission is fixed, which sends people hunting for a SharePoint bug that is no longer there.
