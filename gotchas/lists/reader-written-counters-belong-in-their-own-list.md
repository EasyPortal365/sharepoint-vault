---
title: View counts and ratings written by readers cannot live in a list only editors may write
tags: [lists, permissions, rest-api, provisioning, ux]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-10
---

# View counts and ratings written by readers cannot live in a list only editors may write

> **Bottom line.** A "was this helpful?" button or a view counter is written by the **reader**, not by the author. If that counter is a column on the content list — and that list is protected with `WriteSecurity: 4` so ordinary users cannot rewrite the content — every reader's click returns `403`, the app swallows it, and the UI still says "thanks for your feedback". Your analytics then measure the editorial team only.
>
> **Ve zkratce.** Počítadlo zobrazení a hodnocení zapisuje ČTENÁŘ. Když leží ve sloupci chráněného obsahového listu, běžný uživatel dostane 403, appka ho spolkne a ještě poděkuje — statistiky pak měří jen redakci.

## Symptom

- Ratings and view counts move when **you** (a site owner) browse the app, and never move for anybody else.
- Nothing is logged server-side; the browser console shows a `403` at most, and only if somebody left a `console.warn` in.
- "Most read" lists look plausible but rank the wrong items, because the sample is a handful of admins.

The bug survives testing precisely because whoever tests it holds **Manage Lists**, which bypasses item-level permissions.

## Cause

Two correct decisions that contradict each other:

1. The content list is locked down — `WriteSecurity: 4` (*create and edit: none*), so a member cannot silently rewrite an article, a policy or a product description. This is right.
2. The counter is a column *on that same list*, incremented client-side with a `MERGE` after a read-modify-write. This is also a normal way to build a counter.

Together they mean the only people who can register a "view" are the people allowed to edit the content.

The failure is invisible because the write is fire-and-forget:

```ts
const resp = await sp.post(url, cfg, { headers, body });
if (resp.ok) invalidateCache();   // ← no else branch: 403 disappears here
```

…while the UI has already optimistically incremented the number and disabled the buttons.

## Fix

**1. Split the data by *who writes it*, not by what it is about.**

| Data | Who writes | Setting |
|---|---|---|
| The content itself | editors / approvers | `readSecurity: 1`, `writeSecurity: 4` |
| Anonymous counters (views, up/down votes) | every reader | own list, `readSecurity: 1`, `writeSecurity: 1` |

One row per content item (`Title` = item id, plus a numeric id column and the counters). Do **not** relax the content list to `writeSecurity: 1` to make the counter work — that hands every member edit rights on every field of every record.

**2. Skip the migration: keep the old columns and sum both on read.** Historic values stay where they are, new increments land in the new list, and the read path adds them together. No one-off script, nothing to go wrong halfway through at a customer site.

**3. Make the write report back.** Return the boolean and let the UI act on it:

```ts
async increment(itemId: number, field: 'views' | 'likes'): Promise<boolean> { … }
```

If it fails, roll the optimistic `+1` back and re-enable the buttons. Thanking a user for a vote that was never stored is worse than admitting it did not go through.

**4. Read defensively.** A shared counter with `writeSecurity: 1` is writable by anyone who can use REST, so clamp on read (`< 0 → 0`, ignore non-numeric) and treat the number as a popularity signal, never as an input to anything that matters. If two readers vote at the same time the client-side read-modify-write is last-write-wins — acceptable for popularity, not for anything auditable.

## Side effect worth having

Moving counters off the content list also stops every page view from bumping the item's `Modified` timestamp. "Last updated" starts meaning *the content changed* again — which is what "recently updated" sections, staleness reports and review reminders assumed all along.

## Related

- Item-level permission settings on a provisioned list — the defaults and how to reconcile them.
- Silent fallbacks poison destructive writes: `if (resp.ok)` with no `else` is the same class of bug in a different costume.
