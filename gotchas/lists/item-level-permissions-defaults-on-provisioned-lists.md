---
title: A provisioned list with ReadSecurity=2 looks perfect to an admin and empty to everyone else
tags: [lists, provisioning, permissions, rest-api, security]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-10
---

# A provisioned list with ReadSecurity=2 looks perfect to an admin and empty to everyone else

> **Bottom line.** `ReadSecurity` / `WriteSecurity` are item-level permission settings that live on the list, and anyone holding **Manage Lists** bypasses them. Set them wrong in your provisioning code and the site owner who tests the app sees a full, working list while every ordinary member sees an empty one — `HTTP 200`, zero items, no error anywhere.
>
> **Ve zkratce.** `ReadSecurity`/`WriteSecurity` jsou item-level nastavení listu a kdo má Spravovat seznamy, ten je obchází. Špatná hodnota v provisioningu = správce vidí plný list, běžný člen prázdný, a nikde není chyba.

## The two settings

| Setting | 1 | 2 |
|---|---|---|
| `ReadSecurity` | read **all** items | read **only items the user created** |
| `WriteSecurity` | create and edit **all** items | create items, edit **only own** (4 = create none) |

Both are plain integer properties on `SP.List` and can be read and PATCHed over REST.

## Symptom

Two shapes, and the second one is much easier to miss.

**`ReadSecurity = 2` — the list looks empty.** The same query returns N items to one account and 0 to another, both `HTTP 200`. Classic report: *"in the browser the data is there, in the mobile/Teams client it isn't"* — because those two sessions are signed in as different accounts (site collection admin vs. a normal member). Nothing in the payload hints at a permission filter.

**`WriteSecurity = 2` — collaboration breaks, reads are fine.** Everyone sees everything, so the app looks healthy, and then:

- an approver cannot approve a post somebody else wrote (`403` on the `PATCH`),
- an assignee cannot close a task that was created by their colleague,
- a kanban drag-and-drop reverts mid-gesture with a `403`.

The failures are per-record and per-user, which reads like a flaky back end rather than a setting.

**`WriteSecurity = 4` — "Contribute" becomes an empty gesture.** `4` means *edit no items at all*, so the only way anybody can update an existing item is by holding **Manage Lists** — and of the built-in levels only Full Control, Design and Edit carry it. Grant the group that maintains the content plain **Contribute** and it can create items but never rewrite one; a generator that regenerates a file or row on every change fails from the second run onward. Two things follow, and both are counter-intuitive:

- A permission report showing *"maintainers: Contribute"* looks like a working setup. It is not. On a `WriteSecurity: 4` list, Contribute is indistinguishable from Read for updates.
- "Least privilege" pushes the wrong way here. Dropping a maintainer from Edit to Contribute does not reduce their effective rights — it removes them, and the feature that writes on their behalf breaks silently. If you want them at Contribute, first move the list to `WriteSecurity: 1` and make **unique role assignments** the real boundary.

## Cause

`ReadSecurity`/`WriteSecurity` default to `1` when a list is created through the UI, but **provisioning helpers often pass their own default**. If your `ensureList`-style function does

```ts
ReadSecurity: def.readSecurity ?? 2,
WriteSecurity: def.writeSecurity ?? 2,
```

then every list definition that forgets to state the value gets the restrictive one. The author never notices, because the author is a site collection admin: **Manage Lists bypasses item-level permissions entirely**.

## Fix

**1. State it explicitly for every shared list.** Ask one question per list: *does anyone other than the author edit this row?*

- Shared, collaborative data (records a team works on together) → `readSecurity: 1`, `writeSecurity: 1`.
- Audit trails, comment threads → `readSecurity: 1`, leave write at `2`. Nobody edits a foreign row, so the restrictive default is free protection for history.
- Genuinely per-user data (personal votes, drafts) → `2`/`2` is the right answer, and it is a real privacy mechanism, not an accident.

**2. Reconcile existing sites with a dedicated step — not with a schema-version bump.** This is the part that bites:

- The `PATCH` that sets `ReadSecurity` is usually **best-effort** — it logs a failure and continues.
- The provisioning status/version marker is typically written by whoever loads the app first, and often lives in a list a plain member can write.

So a member opens the updated app, gets `403` on the settings `PATCH`, the columns all exist, the version is marked as done — **and the fix never runs again**. Do it as a separate hook that reads the current values, PATCHes only the difference, returns success or failure, and records "done" **only on success** (otherwise retry in ~24 h, i.e. typically on the next admin visit).

```ts
// GetList by URL is rename-safe; PATCH goes to lists(guid'…')
const info = await get(`${web}/_api/web/GetList('${serverRelListUrl}')?$select=Id,ReadSecurity,WriteSecurity`);
if (info.ReadSecurity !== wantRead || info.WriteSecurity !== wantWrite) {
  const r = await fetchApi(`${web}/_api/web/lists(guid'${info.Id}')`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'IF-MATCH': '*' },
    body: JSON.stringify({ '@odata.type': '#SP.List', ReadSecurity: wantRead, WriteSecurity: wantWrite })
  });
  ok = r.ok || r.status === 204;      // ← this boolean is what "done" must depend on
}
```

**3. Never send `__metadata` + `odata=verbose` from a modern client.** Plain `application/json` with `@odata.type` in the body is the combination that works.

## Diagnostic shortcut

When "the same query returns different counts to different people", check these two things **before** cache, retries or OData formats:

```
GET <site>/_api/web/GetList('<server-relative-list-url>')?$select=Title,ReadSecurity,WriteSecurity
GET <site>/_api/web/currentuser?$select=LoginName,IsSiteAdmin
```

Which account am I in this window, and what does the list actually say. Two requests, and the whole class of "phantom empty list" bugs collapses.

## Related

- Hiding a field in the UI is not a permission — item-level settings are one of the few real per-record boundaries SharePoint offers.
- "The step was marked done" is not "the step ran": any guard whose condition can be satisfied by someone the operation failed for is not a guard.
