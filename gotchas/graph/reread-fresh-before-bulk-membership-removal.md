---
title: Re-read fresh right before you bulk-remove group members
tags: [graph, groups, data-safety]
applies-to: Microsoft Graph (delegated), SPFx
last-reviewed: 2026-07-23
---

# Re-read fresh right before you bulk-remove group members

> **Bottom line.** The roster you showed the user is a preview, not a source of truth — before a `removeMember` loop, re-read the membership *strict and fresh*; a read error must abort (never delete blindly), a member who vanished meanwhile is an idempotent skip, and each delete needs its own try/catch.
>
> **Ve zkratce.** Seznam členů, který jsi ukázal uživateli, je náhled, ne zdroj pravdy – před smyčkou `removeMember` přečti členství znovu, strict a čerstvě; chyba čtení musí akci zrušit (nikdy nemazat naslepo), člen, který mezitím zmizel, je idempotentní přeskočení a každé smazání potřebuje vlastní try/catch.

## Symptom

An access-review or cleanup flow shows a roster ("12 guests"), the reviewer clicks **Remove all**, and one of these goes wrong:

- The list was fetched with a defensive `catch → []` wrapper. On a throttling blip it returned `[]`, the UI showed "0 members", and the remove loop **did nothing** — or worse, a different code path fed a partial list into a delete-then-reconcile step.
- The reviewer opened the panel minutes ago. Between preview and click, someone else changed the group; the loop removes people based on a **stale snapshot** and reports success it can't back up.
- One `removeMember` call fails (last owner, synced/dynamic member) and, because the loop wasn't per-item guarded, it **aborts mid-way** leaving a half-done removal with no accurate count.

## Cause

Two different reads are being conflated:

1. **The read for display** — safe, `catch → []`, good for rendering an empty widget instead of crashing. `[]` here means "couldn't look", not "nothing there".
2. **The read that authorizes a destructive write** — must be strict (throw on failure) and taken *fresh, immediately before* the write, not from component state captured at mount/preview time.

`DELETE /groups/{id}/members/{userId}/$ref` is irreversible for the membership. Driving it from mood-1 data — or from a snapshot that has since drifted — turns a resilience feature into data loss or a phantom "done".

## Fix

Give the membership read both moods and re-read strict **inside the action handler**, right before the loop:

```ts
// WRONG — acts on the roster shown earlier, no per-item guard
async function removeAll(groupId: string, shownRoster: Member[]) {
  for (const m of shownRoster) {
    await graph.api(`/groups/${groupId}/members/${m.id}/$ref`).delete();
  }
}

// RIGHT — fresh strict re-read, idempotent skip, per-item results
async function removeAll(groupId: string) {
  const fresh = await getMembersStrict(groupId); // THROWS on failure — a read error must not delete blindly
  let ok = 0, fail = 0;
  for (const m of fresh) {
    try {
      await graph.api(`/groups/${groupId}/members/${m.id}/$ref`).delete();
      ok++;
    } catch {
      fail++; // per-item: one failure (last owner, synced member) doesn't abort the rest
    }
  }
  return { ok, fail }; // report what you saw: "removed 11, 1 failed"
}
```

For a **single**-target removal (remove this one guest), the same rule collapses to a guard:

```ts
const fresh = await getGuestsStrict(groupId);            // throws → caller's catch skips the delete
if (fresh.some(g => g.id === target.id)) {
  await graph.api(`/groups/${groupId}/members/${target.id}/$ref`).delete();
} // else: already gone — sync the UI, don't surface an error (idempotent skip)
```

Rules that keep it safe:

1. **Read strict and fresh** the membership that authorizes the delete — never the preview array from render state.
2. **Read error ⇒ abort**, don't fall back to `[]` and "remove nothing / remove blindly".
3. **Vanished target ⇒ idempotent skip**, not a failure — the desired end state (not a member) already holds.
4. **Per-item try/catch** in the loop, and **surface the count** (`removed N, M failed`) rather than a bare "done".
5. Hide the action entirely for memberships you can't change this way — **synced (on-prem) and dynamic** groups — so the user never triggers a guaranteed 4xx.

## Notes

- This is the Microsoft Graph / membership face of the general data-safety rule in [Silent fallbacks poison destructive writes](../rest-api/silent-fallbacks-poison-destructive-writes.md) — same principle (strict-and-fresh before a write), specialized for `removeMember` loops and the preview-then-act timing gap.
- The gap is a genuine TOCTOU (time-of-check to time-of-use): the fresh re-read shrinks the window to milliseconds but can't eliminate it, which is exactly why per-item guards and an honest result count matter.
- `getMembers`/`getGuests` should page all results (`$top=999`, follow `@odata.nextLink`) — a strict read that silently stops at 100 is its own quiet bug.
