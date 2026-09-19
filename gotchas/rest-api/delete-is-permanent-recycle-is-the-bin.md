---
title: REST DELETE on a list item is permanent — recycle() is the bin
tags: [rest-api, lists, data-loss, retention]
applies-to: SharePoint Online
last-reviewed: 2026-09-19
---

# REST `DELETE` on a list item is permanent — `recycle()` is the bin

> **Bottom line.** `X-HTTP-Method: DELETE` on `/items(id)` removes the item **for good**: it shows up in neither the site recycle bin nor the site-collection one. If your UI promises "it goes to the recycle bin, you can restore it", you must call `POST /items(id)/recycle()` instead.
>
> **Ve zkratce.** `X-HTTP-Method: DELETE` na `/items(id)` maže položku **natrvalo** – není pak ani v koši webu, ani v koši kolekce. Když UI slibuje „jde to do koše, dá se to obnovit", musí se volat `POST /items(id)/recycle()`.

## Symptom

A cleanup/retention feature deletes rows with the usual REST call and the UI says the rows went to the recycle bin. The admin opens the recycle bin to restore one — and it is empty. The data is gone.

## What is actually going on

Two different operations that look the same from the caller's side:

```http
POST /_api/web/lists/getbytitle('X')/items(42)
IF-MATCH: *
X-HTTP-Method: DELETE
```

deletes the item **permanently** (HTTP 200/204, nothing in either bin), while

```http
POST /_api/web/lists/getbytitle('X')/items(42)/recycle()
Accept: application/json;odata=nometadata
```

moves it to the **site recycle bin** (HTTP 200, returns the new recycle-bin **GUID**) where it appears as `ItemType 3` and can be restored for the tenant's retention window (93 days by default in SharePoint Online).

Measured 2026-09-19 on SharePoint Online, modern list, item created and removed in the same session; `/_api/web/recyclebin` and `/_api/site/recyclebin` were both queried right after each call.

Note that the list UI behaves differently from the API here — deleting a row in the browser recycles it, which is why the API's behaviour surprises people.

## Fix

```js
// permanent — use only when you mean it
await fetch(`${list}/items(${id})`, {
  method: 'POST',
  headers: { 'IF-MATCH': '*', 'X-HTTP-Method': 'DELETE' }
});

// recoverable — what "it goes to the recycle bin" means
const res = await fetch(`${list}/items(${id})/recycle()`, {
  method: 'POST',
  headers: { Accept: 'application/json;odata=nometadata' }
});
// res.ok → body is the recycle-bin item GUID
```

Verify it rather than trusting the call name:

```http
GET /_api/web/recyclebin?$select=Title,ItemType,DeletedDate&$top=10&$orderby=DeletedDate desc
```

## Why it bites

The wording in a UI is a promise about the data, and it is as binding as the feature itself. A retention or wipe screen that says "restorable for 93 days" over a permanent delete is worse than one that admits the delete is final — the admin makes different decisions based on it.

Two habits that catch this class of bug:

- After a destructive feature works, **open the recycle bin** and look. The delete returning 200 tells you nothing about where the item went.
- When you write a sentence about a data property (immutable, encrypted, restorable, retained for N days), find the line of code that makes it true. If there isn't one, change the sentence or write the code.

## See also

- [Get lists by URL, not by title](get-list-by-url-not-by-title.md) — the other half of a safe delete call is addressing the right list.
