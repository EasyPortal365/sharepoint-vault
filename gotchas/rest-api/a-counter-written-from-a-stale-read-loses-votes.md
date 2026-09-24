---
title: SharePoint REST has no increment — a "+1" computed from the count you read at page load loses every vote cast in between
short-title: SharePoint REST has no increment
summary: "A MERGE writes a value, so `count + 1` from what the page loaded, sent with `IF-MATCH: *`, overwrites every vote cast since that page load; count distinct `AuthorId`s of per-user rows, or read fresh and write with the item's ETag"
tags: [rest-api, lists, concurrency, etag, counters, votes]
applies-to: SharePoint Online and Server REST (any client that keeps a counter column up to date with MERGE)
last-reviewed: 2026-09-24
---

# SharePoint REST has no increment — a "+1" computed from the count you read at page load loses every vote cast in between

> **Bottom line.** There is no "add one" operation in SharePoint REST: a MERGE writes a value. So every client-side `+1`/`−1` is read–modify–write, and if the "read" is the number the page loaded minutes ago and the write goes out with `IF-MATCH: *`, the counter is overwritten with a stale total — every vote cast by anyone else since that page load disappears, not only the ones that collide within the same second. Derive counts from the per-user rows where you can; where a stored counter must exist, read it fresh and write with its ETag.
>
> **Ve zkratce.** SharePoint REST nemá operaci „přičti jedna“: MERGE zapisuje hodnotu. Každé klientské `+1`/`−1` je tedy čtení–úprava–zápis, a když „čtení“ je číslo, které stránka načetla před minutami, a zápis jde s `IF-MATCH: *`, čítač se přepíše zastaralým součtem – zmizí každý hlas, který kdokoli jiný odevzdal od toho načtení, ne jen ty, které se srazí ve stejné vteřině. Kde to jde, počítej z per-user řádků; kde uložený čítač být musí, čti ho čerstvě a zapisuj s jeho ETagem.

## Symptom

A "Was this helpful?" button, a like or an up-vote shows sensible numbers in testing, where one person clicks at a time. With real users the stored total falls behind the number of vote rows: votes vanish without any error, and a single tester never reproduces it. (We found it in code review, not as a production incident; the replacement's tests pin exactly this case — see the notes.)

The code looked innocent:

```ts
// count came from the list read when the page loaded
async function toggleVote(answer: { id: number; count: number }, on: boolean) {
  await createOrDeleteMyVoteRow(answer.id, on);
  await merge(`…/items(${answer.id})`, { HelpfulCount: answer.count + (on ? 1 : -1) },
              { 'IF-MATCH': '*' });
}
```

## Cause

1. **No server-side increment.** The body carries the *new absolute value*. The server stores it.
2. **The read is as old as the page.** `answer.count` was read at page load. Anyone who voted after that — minutes or hours ago, in another tab or on another device — is included in the server's value but not in yours, and your write replaces it.
3. **`IF-MATCH: *` turns off the only protection.** With the item's real ETag the stale write would be rejected with **412**; with `*` it always wins.

Two things usually ride along with the same design:

- **The reader may not be allowed to write there.** If the counter sits on the content list and that list is protected so members only read, the counter write fails with 403 — *after* the vote row was created, leaving half an operation behind ([View counts and ratings written by readers cannot live in a list only editors may write](../lists/reader-written-counters-belong-in-their-own-list.md)).
- **On a versioned list every vote is an edit.** Each MERGE creates a new version of the item and overwrites `Editor` / `Modified`, burying real content changes in the version history.

## Fix

**Prefer not to store the number at all.** If each vote is its own row (one per user and item), the count is the number of **distinct `AuthorId`s** for that item — `AuthorId` is set by the server, so a client cannot fake it, and a duplicated row does not count twice:

```ts
const rows = await getAll(`…/items?$select=Id,AuthorId,AnswerId&$filter=AnswerId eq ${answerId}`);
const count = new Set(rows.map(r => r.AuthorId)).size;
```

The catch: on a per-user list (`ReadSecurity = 2`) an ordinary reader only sees their own rows, so the sum is only complete for accounts that can read everything — see [A count over a ReadSecurity 2 list is the reader's share](../permissions/a-count-over-a-readsecurity-2-list-is-the-readers-share.md). Show the number only where it is complete.

**If a stored counter must exist** (an anonymous aggregate readers may write):

```ts
async function bump(url: string, field: string, delta: number, tries = 3): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const r = await get(`${url}?$select=${field}`);             // fresh read, right before the write
    const etag = itemEtag(r);                                   // the item's ETag — see the notes
    const next = Math.max(0, (Number((await r.json())[field]) || 0) + delta);
    const w = await merge(url, { [field]: next }, { 'IF-MATCH': etag });
    if (w.ok) return;
    if (w.status !== 412) throw new Error(`HTTP ${w.status}`);  // 412 = somebody wrote in between: re-read
  }
  throw new Error('Counter kept changing — try again.');
}
```

Never compute the new value from what the page loaded, and never send `IF-MATCH: *` for a counter.

## Notes

- "Shift the counters by the difference (−1/+1) in one write" is good advice only if it means *one MERGE carrying both new absolute values, computed from a fresh read*. Read as "send a delta", it leads straight to the code above — SharePoint has no delta.
- A counter readers can write can also be rewritten by anyone with REST access. Treat it as a display value and keep a recount from the per-user rows for an administrator — who must be able to read *all* rows, or the recount wipes other people's votes.
- Test it the way it fails: two users voting on the same item from two pages loaded before either vote must end at 2, and a vote cast between another user's page load and click must survive.
- Where the item's ETag reaches your code (a response header, or an `odata.etag` annotation in the body) depends on the client and the OData mode; we did not measure it for this article, so check it once in yours. That a stale `IF-MATCH` is answered with 412 is measured — [A status code measures the order of checks, not permissions](../permissions/status-code-measures-the-order-of-checks-not-permissions.md).
