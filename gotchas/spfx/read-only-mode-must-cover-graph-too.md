---
title: A read-only mode that wraps SPHttpClient still sends e-mail — Graph is a second channel
tags: [spfx, graph, permissions, patterns]
applies-to: SPFx web parts (SPHttpClient + MSGraphClientFactory)
last-reviewed: 2026-08-31
---

# A read-only mode that wraps SPHttpClient still sends e-mail — Graph is a second channel

> **Bottom line.** The cheapest way to make a web part read-only — an admin previewing the app as someone else, a demo mode, a locked licence — is to wrap `SPHttpClient` once and let it reject everything that isn't a GET. It works, and it's much safer than sprinkling `if (readOnly)` through twenty handlers. But a typical SPFx app writes through **two** independent clients: `SPHttpClient` for SharePoint and `MSGraphClientFactory` for mail, calendar, Planner and groups. The wrapper never sees the second one, so "read-only" mode happily sends notification e-mail on somebody else's behalf.
>
> **Ve zkratce.** Nejlevnější způsob, jak z webpartu udělat režim jen pro čtení (náhled správce očima jiného uživatele, demo, uzamčená licence), je obalit `SPHttpClient` a odmítnout všechno kromě GET. Funguje to a je to bezpečnější než dvacet `if (readOnly)` v handlerech. Jenže SPFx appka běžně zapisuje **dvěma** nezávislými klienty: `SPHttpClient` do SharePointu a `MSGraphClientFactory` na poštu, kalendář, Planner a skupiny. Obal ten druhý nikdy neuvidí — a „režim jen pro čtení" v klidu odešle notifikační e-mail jménem někoho jiného.

## Symptom

You add a preview/read-only mode, verify it by trying to save a list item (correctly refused), and ship. Later someone notices e-mail going out from a session that was supposed to write nothing — an approval notification, a reminder, a "task assigned" message. The list stayed untouched, so nothing in SharePoint hints at what happened.

The same hole covers anything routed through Graph: creating a Planner task, adding a calendar event, patching a group.

## Cause

The wrapper is a choke point for exactly one transport:

```
// blocks writes — for SharePoint only
function readOnlySpClient(real) {
  return {
    get:   (u, c, o) => real.get(u, c, o),
    post:  (u, c, o) => ALLOWED_READ_POSTS.test(u) ? real.post(u, c, o) : Promise.reject(new Error(MSG)),
    fetch: (u, c, o) => ((o?.method || 'GET').toUpperCase() === 'GET' || ALLOWED_READ_POSTS.test(u))
      ? real.fetch(u, c, o) : Promise.reject(new Error(MSG))
  };
}
```

`MSGraphClient` doesn't go through it. It's built from `context.msGraphClientFactory`, holds its own token and its own HTTP stack — a service doing `client.api('/me/sendMail').post(...)` is invisible to the code above.

## Fix

Wrap every write-capable client, not just the SharePoint one. For Graph, the muted version should return the value the callers already handle for "sending failed" — but **build it by subclassing the real service, not by casting an object literal to its type**:

```ts
// mail service used by views; in read-only mode it just reports failure
export class MutedMailService extends GraphMailService {
  public async send(): Promise<boolean> { return false; }   // callers already handle false
}

const mail = readOnly ? mutedMail : realMail;
```

> ⚠️ **The obvious shortcut rots silently.** The tempting version is a literal with the one method you need, cast into place:
>
> ```ts
> function readOnlyMail(): GraphMailService {
>   const stub = { send: () => Promise.resolve(false) };
>   return stub as unknown as GraphMailService;   // ← don't
> }
> ```
>
> `as unknown as T` is a double assertion — it switches off *every* structural check, so the compiler never compares what the stub implements against what `T` promises. It is correct the day you write it and **decays with the next method added to the service**. Six months later `notifyDecision()` exists, views call it, the read-only path throws `notifyDecision is not a function`, and neither the compiler nor the linter nor the build says a word. Worse, it only fires in the mode nobody routinely clicks through. Subclassing makes the compiler enforce the contract for you; `Object.create(real)` with a single overridden method is the other safe shape, because everything you didn't override survives on the prototype chain. Keep double assertions for **real instances** and for **data** (DTOs, style objects, the shape of a dynamic `import()`) — never to fake behaviour you haven't written.

Two things worth doing while you're there:

- **Enumerate the outbound channels once, in the shell.** Grep the app for `msGraphClientFactory`, `fetch(`, `axios`, `navigator.sendBeacon` and any SDK client. Each one is a separate hole; the list is short and it doesn't change often.
- **Watch for silent write side effects on read paths.** View counters, "last opened" stamps and telemetry rows are writes too — in a preview they leave a trace that says the wrong person opened something.

## Verifying it

Don't test the mode by clicking Save — a disabled button proves nothing about the layer underneath. Reach the client the views actually receive (in React, via the fiber on your root node) and issue a write to a harmless URL:

```
await ctx.spHttpClient.post(webUrl + '/_api/web/DOES_NOT_EXIST', {}, { headers: {} })
// wrapper working  → rejected locally, no request leaves the browser
// wrapper bypassed → HTTP 404 from SharePoint (it reached the server)
```

The difference between "rejected by the client" and "404 from the server" is what tells you the choke point is real. Repeat for the Graph path with whatever your app's send/create call is, on a target you own.
