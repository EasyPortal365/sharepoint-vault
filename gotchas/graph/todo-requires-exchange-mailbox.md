---
title: Microsoft To-Do (/me/todo) needs an Exchange mailbox — admin accounts 404
short-title: "`/me/todo` needs an Exchange mailbox"
summary: "404 \"Item not found\" on accounts without a mailbox and an empty 401 UnknownError for guests are not consent problems; Planner works without a mailbox"
tags: [graph, tasks, todo, planner, mailbox, guest]
applies-to: Microsoft Graph (Microsoft 365)
last-reviewed: 2026-11-19
---

# Graph `/me/todo`: 404 "Item not found" on accounts without an Exchange mailbox

> **Bottom line.** `Tasks.ReadWrite` covers both Planner and To-Do, but To-Do lives on the user's Exchange Online mailbox — cloud-only / dedicated admin accounts without a mailbox get a 404 from `/me/todo/lists`, which is NOT a permission problem. Planner (`/me/planner/plans`, `/planner/*`) is Group-based and works without a mailbox, so it can succeed while To-Do fails under the same scope.
>
> **Ve zkratce.** `Tasks.ReadWrite` pokrývá Planner i To-Do, ale To-Do žije nad Exchange schránkou uživatele – čistě cloudové / administrátorské účty bez schránky dostanou z `/me/todo/lists` 404, což NENÍ problém oprávnění. Planner je Group-based a bez schránky funguje, takže se stejným scope může Planner projít a To-Do selhat.

## Symptom

Your app creates a task via `POST /me/todo/lists/{id}/tasks`. On some accounts the very first call — `GET /me/todo/lists` — fails with **404 "Item not found"**, even though `Tasks.ReadWrite` is consented and Planner calls (`GET /me/planner/plans`) succeed on the same account. The 404 tempts you to blame the scope or consent.

## Cause

Microsoft To-Do is backed by the user's **Exchange Online mailbox** (its tasks are stored there). Accounts without a mailbox — cloud-only / dedicated administrator accounts with no Exchange license — have no To-Do store, so `/me/todo/lists` returns 404. It is a missing-resource error, not `403 Forbidden`. Planner tasks live under Microsoft 365 **Groups**, not a mailbox, which is why `/me/planner/plans` returns fine (often an empty array) with the identical `Tasks.ReadWrite` scope.

## Fix

Distinguish the two failure modes and tell the user the truth:

```ts
let lists;
try {
  lists = await client.api('/me/todo/lists').version('v1.0').get();
} catch (e) {
  // 404 here = no To-Do store (account without an Exchange mailbox)
  throw new Error('This account has no Microsoft To-Do (no Exchange mailbox). Use Microsoft Planner, or run from a regular user account.');
}
```

- Do not append a generic "check your Tasks.ReadWrite permission" to every task-creation failure — a 404 is not a 403. Add the permission hint only when the message does not already point at a missing mailbox or plan.
- If one "Create task" button must work everywhere, offer **Planner** (Group-based, no mailbox) as the primary target and To-Do as a personal convenience.

## Two more shapes of the same cause (measured 2026-11-19)

| Account | `GET /me/todo/lists` | Mail on the same account |
|---|---|---|
| Member without a mailbox | `404 itemNotFound` "Item not found" – `MailboxNotEnabledForRESTAPI` only in `innerError.code` | `404 MailboxNotEnabledForRESTAPI` |
| **Guest** in another tenant | **`401 UnknownError`, empty `message`, empty `innerError`** | `404 MailboxNotEnabledForRESTAPI` |

The guest case is the dangerous one: a 401 looks exactly like missing consent, so a generic error mapper tells the user to ask an admin for `Tasks.ReadWrite` – which is already granted. Rules:

- Read `innerError.code` as well as the top-level `code` when you classify "no mailbox"; a matcher on `code`/`message` alone misses the member case.
- Treat `401` with code `UnknownError` **and an empty message** from `/me/todo/*` as "no mailbox (guest)". Keep any 401 that carries a message (e.g. `InvalidAuthenticationToken`) as a real auth failure.

## Notes

- `Tasks.ReadWrite` is a single scope that spans both APIs; the split is about where the data lives (mailbox vs. group), not about permissions.
- A successful `GET /me/planner/plans` returning an empty array just means the user is not a member of any plan — also not an error, just nothing to write to.
