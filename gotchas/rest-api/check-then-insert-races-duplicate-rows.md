---
title: Check-then-insert races produce duplicate rows — and "keep the lowest Id" dedup deletes the wrong one
tags: [rest-api, concurrency, idempotency, registry]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-19
---

# Check-then-insert races produce duplicate rows — and "keep the lowest Id" dedup deletes the wrong one

> **Bottom line.** A GET-check-then-POST-insert on a constraint-less SharePoint list races into duplicate rows, and "keep the lowest Id" deletes the wrong one — upsert with a normalized key on write, resolve duplicates on read by version or `Modified` (never by `Id`), and leave deletion to a human.
>
> **Ve zkratce.** GET-kontrola a následné POST-vložení do SharePointového seznamu bez unikátního omezení v souběhu vytvoří duplicity a „nech nejnižší Id" smaže tu špatnou – při zápisu dělej upsert s normalizovaným klíčem, duplicity řeš až při čtení podle verze nebo `Modified` (nikdy podle `Id`) a mazání nech na člověku.

A SharePoint list has no unique constraint. Any "register once" pattern built as *GET-to-check → POST-to-create* is a classic time-of-check-to-time-of-use (TOCTOU) race, and the obvious cleanup makes it worse.

## Symptom

A list that should hold one row per logical entity (an app registry, a per-user preference, a "seen" marker) shows **two rows with identical business keys**, created seconds apart. Often they differ only in some secondary field — a version string, a timestamp — which is the tell that two writers ran concurrently.

## Cause

```ts
// two callers run this near-simultaneously
const existing = await getItems(`$filter=Key eq '${key}'`);   // both see []
if (!existing.length) {
  await createItem({ Key: key, ... });                        // both insert
}
```

The check and the insert are not atomic, and SharePoint gives you no way to make them atomic (no unique index, no upsert). Two tabs, two web parts, or a fast reload fire both writers before either commits. Worse, list indexing is **eventually consistent** — even a slightly later `$filter` can miss a row that was just POSTed, so retries and "did it save?" re-checks create *more* duplicates, not fewer.

## The tempting fix that loses data

> "On registration, if duplicates exist, keep the oldest (lowest `Id`) and delete the rest."

**Don't.** Lowest `Id` means *first created*, which is not the same as *most correct*. A very real ordering:

| Id | Created | Version |
|----|---------|---------|
| 4  | 10:27   | 2.8.0   |
| 5  | 10:28   | 1.0.0   |

The **newer** row carries the **older** version — e.g. a stale bundle served from cache registered last. "Keep lowest `Id`" would delete the current registration and keep the stale one. And any operation that deletes rows it didn't create, as a side effect of a routine write, is a data-loss incident waiting for the wrong inputs.

## The fix

1. **Never delete on the write path.** Make the writer *find-or-update*, matching the business key **case-insensitively and normalized** (for a site/URL key: lowercase, strip the trailing slash). Normalization prevents a whole class of "duplicates" that are really just `/Site` vs `/site`. It won't retroactively merge rows a race already created, but it stops new ones.

2. **Deduplicate on read, not on write.** Let the *consumer* collapse duplicates: group by the normalized key and surface only the **best** row — newest by a real version comparison or by `Modified`, never by `Id`/creation order. The physical duplicates stay in the list, harmless, until a human removes them after eyeballing which is which.

3. **Serialize the writer client-side.** An in-flight flag ("already registering") plus "only write when something actually changed" stops one component's `init` + `onChange` from firing two writes in the same tick. This shrinks the race window that (1) and (2) then cover for.

4. **If you must delete a duplicate, choose by version/recency, never by `Id`.**

## Diagnosis

Read the list live and compare the rows — don't guess the cause:

```
GET /_api/web/lists/getbytitle('<Registry>')/items?$filter=Key eq '<key>'
    &$select=Id,Key,Version,Created,Modified
```

Identical secondary keys ⇒ a genuine concurrency race or index-lag double-insert. Different keys that only *look* the same ⇒ a normalization bug (case, trailing slash, encoding) — fix the matching, not the data.

## Notes

- Rule of thumb: **writes are idempotent upserts; readers resolve duplicates; deletion is a human decision.**
- This is the concurrency sibling of [silent fallbacks poisoning destructive writes](silent-fallbacks-poison-destructive-writes.md): there a `catch → []` fed a delete; here an eventually-consistent `[]` feeds a duplicate insert. Both come from trusting a read that isn't the ground truth.
