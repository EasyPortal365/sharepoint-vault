---
title: Silent catch-to-empty fallbacks + destructive writes = data loss
tags: [rest-api, architecture, data-safety]
applies-to: Any app with a defensive data layer (SharePoint or otherwise)
last-reviewed: 2026-07-28
---

# Silent `catch → []` fallbacks + destructive writes = data loss

> **Bottom line.** A `catch → []` read wrapper is fine for rendering but catastrophic as the input to a write — give the data layer both a strict and a safe mood, and make every destructive or accounting operation read strict and fresh.
>
> **Ve zkratce.** Wrapper `catch → []` je v pořádku pro zobrazení, ale jako vstup do zápisu je katastrofa – dej datové vrstvě strict i safe režim a každou destruktivní či účetní operaci nech číst strict a čerstvě.

## Symptom

A monthly closing job syncs records with a *delete-all-then-insert-all* pattern. One day — a throttling burst, a network blip — it **deletes everything and inserts nothing**, then cheerfully reports "0 records synced" as success. Variants of the same accident: a read-merge-write config save wipes the config down to the last patch; a carry-over computed "from zero" writes a full unspent balance.

## Cause

The defensive read wrapper every mature codebase grows:

```ts
private async safe<T>(p: Promise<T[]>): Promise<T[]> {
  try { return await p; } catch { return []; }
}
```

is a **great default for rendering** ("show an empty widget, don't crash the page") and a **catastrophic input to anything that writes based on what it read**. `[]` stops meaning "there is nothing" and starts meaning "there *might* be everything, we just couldn't look".

## Fix

Make the data layer offer **both moods**, and pick per call site:

```ts
getProjectsStrict(): Promise<IProject[]>   // throws on failure
getProjects():        Promise<IProject[]>  // = safe(getProjectsStrict()) — for display
```

Rules that keep the destructive paths safe:

1. **Destructive/accounting operations read strict** — and read *fresh*, never from displayed component state.
2. **Scoped fallbacks need a status check** — falling back to a narrower `$select` is legitimate *only* for the errors it's meant for (HTTP 400 on a not-yet-provisioned column). A fallback on any error masks outages with plausibly-thin data.
3. **Delete-then-insert syncs must abort the insert if the delete phase failed even partially** — otherwise you duplicate records on the next run.
4. **Add/remove over a config array** operates on a fresh strict read inside the handler — not on a context snapshot from mount (a stale admin tab silently reverts another admin's changes).
5. **Access-control writes never skip a failed delete** — a revoked permission that silently stays granted is a security bug, not a resilience feature.

## Notes

- Cheap audit: grep your codebase for the safe-wrapper name and walk each caller asking *"does anything write based on this value?"* The hits cluster in exactly the scariest places — closings, syncs, imports, config saves.
- UI corollary: a destructive job reporting success should state *what it saw* ("deleted 240, inserted 240"), not just that it ran — "0 and 0" would have been noticed immediately.

## Variant (2026-07-28): a settings read that hides its own failure

The same wrapper on a **configuration** read is worse than on a list read, because the write that
follows is a *blind full-object save*:

```ts
async function getSettings() {
  try {
    const r = await get(url);
    if (!r.ok) return null;        // ← "read failed"
    const rows = await r.json();
    return rows.value[0] ?? null;  // ← "row does not exist" — SAME value
  } catch { return null; }         // ← and again
}
```

The caller cannot tell the two apart, so it does the only thing it can: fall back to built-in
defaults. Then the settings form — seeded from those defaults — saves the **whole object**, and a
transient 429/503 at page load silently overwrites every field an administrator had configured
(search scope, model, budgets, audit flags). Nobody sees an error, because there wasn't one.

Three rules that close it:

1. **`throw` on read failure, return "empty" only for a genuinely missing record.** Then the
   caller's `catch` stops being dead code. (Ours was: the whole body sat in `try/catch`, so the
   promise never rejected and the error banner never appeared.)
2. **Gate the save on a confirmed load.** Keep a `loaded` flag and refuse to save without it —
   with a message, not a silent no-op: *"settings could not be loaded, so saving is blocked; it
   would overwrite your configuration with defaults."*
3. **Re-read when the settings screen opens.** A full-object save from a snapshot taken at page
   load also loses a second administrator's concurrent changes; re-reading narrows the window from
   "the whole session" to "since the screen opened". Field-level dirty tracking closes it fully.

Related SharePoint-specific trap in the same area: **a `MERGE` (PATCH) that omits a field does not
clear it**. "Only write non-empty values" therefore means the value can never be *removed* through
the UI — it reappears after every reload. If a field must be clearable, send the empty string.
