---
title: A network drop through the Microsoft Graph JS client looks like an HTTP error with status -1
short-title: "Graph client network failure = `statusCode: -1`"
summary: msgraph client wraps a failed `fetch` as `GraphError` statusCode -1, code `TypeError` – detect it, don't report "permission denied"
tags: [graph, spfx, errors, network]
applies-to: "@microsoft/microsoft-graph-client 3.x, SPFx MSGraphClientV3"
last-reviewed: 2026-10-18
---

# A network drop through the Microsoft Graph JS client looks like an HTTP error with status -1

> **Bottom line.** When the request never reaches Graph (connection drop, VPN switch, expired sign-in redirect), the Microsoft Graph JavaScript client does not rethrow the browser's `TypeError` — it wraps it in a `GraphError` with `statusCode: -1`, `code: 'TypeError'` and the browser message. Detect that shape explicitly; otherwise your generic "Graph call failed – probably a missing permission" message tells the user a write failed when nobody knows whether it did.
>
> **Ve zkratce.** Když požadavek na Graph vůbec nedojde (výpadek spojení, přepnutí VPN, přesměrování na přihlášení), klient Microsoft Graphu nevyhodí `TypeError` prohlížeče, ale zabalí ho do `GraphError` se `statusCode: -1`, `code: 'TypeError'` a hláškou prohlížeče. Ten tvar rozpoznej výslovně – jinak obecná hláška „volání Graphu selhalo, nejspíš chybí oprávnění“ tvrdí neúspěch zápisu, o kterém nikdo neví, jestli nastal.

## Symptom

A user creates a group / sends a mail / updates a user from an SPFx web part during a brief
connection drop. The app shows something like:

```
Creating the group failed. Most often the permission Group.ReadWrite.All is missing. [HTTP -1 · TypeError: Failed to fetch]
```

Two things in that message are false: nothing proves the operation failed (the request may
have reached Graph and only the response got lost), and permissions have nothing to do with it.
Your `isNetworkError(e)` helper — the one that checks `e.name === 'TypeError'` for raw `fetch`
failures — returned `false`.

## Cause

`GraphRequest.send()` catches whatever `fetch` throws and passes it to
`GraphErrorHandler.getError(error, statusCode)`; with no response, `statusCode` keeps its
default `-1`. For a native `Error` the handler calls `constructError`, which produces
(library 3.0.2, `lib/src/GraphErrorHandler.js`):

| Property | Value for a network drop |
|---|---|
| `statusCode` | `-1` (default = no response at all, not an HTTP status) |
| `code` | `error.name` → `'TypeError'` |
| `message` | browser text: `Failed to fetch` (Chrome/Edge), `NetworkError when attempting to fetch resource.` (Firefox), `Load failed` (Safari) |
| `body` | `error.toString()` → `'TypeError: Failed to fetch'` |
| `name` | `'Error'` — so `name === 'TypeError'` checks miss it |

`MSGraphClientV3` in SPFx is this same client, so web parts get the same shape.

## Fix

Recognise it by **all three** markers, so a real HTTP error is never mistaken for a network
drop:

```ts
const NET_RE = /failed to fetch|networkerror when attempting to fetch|load failed|network request failed|fetch failed/i;

export function isGraphClientNetworkFailure(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const x = e as { statusCode?: unknown; code?: unknown; message?: unknown; body?: unknown };
  if (x.statusCode !== -1) return false;                       // real HTTP status → not a network drop
  const body = typeof x.body === 'string' ? x.body : '';
  if (x.code !== 'TypeError' && body.indexOf('TypeError') !== 0) return false; // -1 from AbortError etc.
  return (typeof x.message === 'string' && NET_RE.test(x.message)) || NET_RE.test(body);
}
```

Then answer honestly, by operation type:

- **write** (POST/PATCH/DELETE): "The connection to Microsoft 365 was interrupted — there is no way
  to tell whether the change was made. Reload the page and check the current state."
- **read**: "The connection to Microsoft 365 was interrupted — the data could not be loaded."

Show the raw browser text as `[Failed to fetch]`, not `[HTTP -1 · …]` — `-1` is not a status
the server sent.

Counter-examples worth a unit test:

- `403 Authorization_RequestDenied` → still "access denied", never "connection interrupted";
- a 403/500 whose *message* happens to contain "Failed to fetch…" → not a network drop
  (status is not `-1`);
- `statusCode: -1` with `code: 'AbortError'` (request cancelled) → not a network drop.

## Takeaway

With the Graph JS client, "status -1" means "no response", not an HTTP error. Detect
`statusCode === -1` + `code === 'TypeError'` + browser network text, and for writes say you
don't know the outcome instead of claiming a failure and guessing a permission problem.
