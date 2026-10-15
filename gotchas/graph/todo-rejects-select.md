---
title: Microsoft To Do rejects $select on lists and tasks — 400 invalidRequest (RequestBroker--ParseUri)
short-title: "To Do rejects `$select` (400 ParseUri)"
summary: "Since Oct 2026 `/me/todo/lists` and `/tasks` return 400 for any `$select` except `id`; drop `$select`, keep `$top`/`$filter`, and measure 400s call by call before trusting a docs-based theory"
tags: [graph, tasks, todo, odata, troubleshooting]
applies-to: Microsoft Graph v1.0 and beta (Microsoft 365)
last-reviewed: 2026-10-15
---

# Microsoft To Do rejects `$select` — 400 `invalidRequest` / `RequestBroker--ParseUri`

> **Bottom line.** `GET /me/todo/lists?$select=id,displayName,wellknownListName` (and the same on `/tasks`) now fails with **400 invalidRequest**, inner code `RequestBroker--ParseUri`. Only `$select=id` passes; `$top` and `$filter` still work. Drop `$select` from To Do calls — and when Graph returns 400, measure each call and each query parameter live before you "fix" a theory taken from the docs.
>
> **Ve zkratce.** `GET /me/todo/lists?$select=…` (i na `/tasks`) teď vrací **400 invalidRequest** s vnitřním kódem `RequestBroker--ParseUri`. Projde jen `$select=id`; `$top` a `$filter` fungují. U To Do `$select` vynech – a u Graph 400 nejdřív změř naživo jednotlivá volání a parametry, než „opravíš“ hypotézu z dokumentace.

## Symptom

Creating a task (`POST /me/todo/lists/{id}/tasks`) fails with:

```
HTTP 400 · invalidRequest: Invalid request
```

The user has a mailbox and a To Do licence, and the code had been in production for months without changes. The error surfaces on the "create" button, so it looks like the POST body is wrong — but the failing request is the **list lookup before it**.

## Cause

Measured on 2026-10-15 on one tenant and one user account (Graph v1.0 and beta, delegated `Tasks.ReadWrite`) — re-check on yours:

| Request | Result |
|---|---|
| `GET /me/todo/lists` | 200 |
| `GET /me/todo/lists?$top=50` | 200 |
| `GET /me/todo/lists?$select=id` | 200 |
| `GET /me/todo/lists?$select=displayName` (or any other property, or a list) | **400 `RequestBroker--ParseUri`** |
| `GET /me/todo/lists/{id}/tasks?$filter=status ne 'completed'` | 200 |
| `GET /me/todo/lists/{id}/tasks?$select=id,title,status,dueDateTime` | **400 `RequestBroker--ParseUri`** |

The [List lists](https://learn.microsoft.com/graph/api/todo-list-lists) reference says only that the method "supports some of the OData query parameters", without saying which — so `$select` is not a documented guarantee. Since the same code had worked before, treat it as a service-side change you must tolerate: don't depend on `$select` here.

## Fix

Don't send `$select` to To Do; filter fields client-side.

```ts
// before: .api('/me/todo/lists').select('id,displayName,wellknownListName').top(50)
const lists = await client.api('/me/todo/lists').top(50).get();

// pick the default list; never fall back to "Flagged Emails" — it does not accept new tasks
const def = lists.value.find(l => l.wellknownListName === 'defaultList')
  ?? lists.value.find(l => l.wellknownListName !== 'flaggedEmails');

const open = await client
  .api(`/me/todo/lists/${encodeURIComponent(def.id)}/tasks`)
  .query({ $filter: "status ne 'completed'" })   // still supported
  .top(50)                                         // still supported
  .get();
```

## Notes

- **Measure, don't guess.** A first theory here was the due-date time zone (`dateTimeTimeZone` docs list Windows zone names; `Europe/Prague` is not among the examples). It was plausible, shipped — and changed nothing. Splitting the request parameter by parameter found the real cause in minutes.
- **Getting a Graph token from the browser console without an app registration:** on a *modern* SharePoint page (the classic `/_api/SP.OAuth.Token/Acquire` refuses `https://graph.microsoft.com` with "Resource is not allowed"):

  ```js
  const ml = await window.moduleLoaderPromise;
  const provider = await ml.context.aadTokenProviderFactory.getTokenProvider();
  const token = await provider.getToken('https://graph.microsoft.com');
  const r = await fetch('https://graph.microsoft.com/v1.0/me/todo/lists?$select=displayName',
    { headers: { Authorization: 'Bearer ' + token } });
  console.log(r.status, await r.json());
  ```

  The token carries the scopes granted to SPFx in your tenant and runs as the signed-in user — read-only probing is safe; don't POST test data you won't clean up.
- **Error copy:** a 400 on a request URL or body is not "missing mailbox or licence". Reserve that hint for 404/403 on reads (see [todo-requires-exchange-mailbox](todo-requires-exchange-mailbox.md)).
