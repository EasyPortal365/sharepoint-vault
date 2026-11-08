---
title: "Two MERGEs to the same list item at once: the second one fails with 409 Save Conflict even with IF-MATCH: * – and a fire-and-forget write just disappears"
short-title: "Concurrent MERGE to one item: 409"
summary: "`IF-MATCH: *` only switches off the ETag check (412); SharePoint still refuses a second save of the same item while the first is in flight with 409 Save Conflict. Queue writes per item (`list#id`), retry 409 briefly, never retry 412, and do not let a state-carrying write fail silently"
tags: [rest-api, lists, concurrency, etag, merge, spfx]
applies-to: SharePoint Online REST (MERGE / PATCH on list items from SPFx or any client)
last-reviewed: 2026-11-08
---

# Two MERGEs to the same list item at once: the second one fails with 409 Save Conflict even with IF-MATCH: * – and a fire-and-forget write just disappears

> **Bottom line.** `IF-MATCH: *` tells SharePoint not to compare ETags – it does not let two saves of the same item run at the same time. When one client action fires several independent MERGEs at one item (a preview field, a setting, a rename, a counter), the ones that overlap come back **409 Save Conflict** and the change is lost. Serialize writes per item, retry a 409 after a short pause, do not retry a 412, and report a failed write the user will notice.
>
> **Ve zkratce.** `IF-MATCH: *` vypne jen porovnání ETagu – souběžné uložení téže položky nepovolí. Když jedna akce pošle na stejnou položku víc nezávislých MERGE (náhled, nastavení, přejmenování, počítadlo), ty, které se překryjí, vrátí **409 Save Conflict** a změna se ztratí. Zápisy do jedné položky řaď za sebe, 409 po krátké pauze zopakuj, 412 neopakuj a selhání zápisu, které uživatel uvidí, mu oznam.

## Symptom

A chat app stores per-conversation settings on the conversation's list item. When the user asks a question, the app saves the message, writes a "last message" preview to the conversation item, and – in the same moment – saves which data sources the conversation uses. In the console:

```
PATCH …/GetList('…/Lists/Conversations')/items(271)  409
```

The source choice works until the page is reloaded, then it is gone. Nothing is shown to the user, because the write was `void save(...)` with a `console.warn` in the catch. A single slow click-through in testing rarely reproduces it; it shows up when two writes happen to overlap.

## Cause

1. **Several writers, one item.** Each feature updates "its" column with its own MERGE and does not know the others are running: preview of the last message, the settings column, an automatic rename, a message counter.
2. **SharePoint saves an item one request at a time.** A second save that arrives while the first is being committed is refused with **409** ("Save Conflict" / "Your changes conflict with those made concurrently by another user"). The columns do not overlap – it does not matter.
3. **`IF-MATCH: *` does not help.** It only disables the ETag check, whose failure is a different status: **412 Precondition Failed**. The 409 is about the concurrent save, not about versions.

## Fix

```ts
const queues = new Map<string, Promise<unknown>>();
const RETRY_MS = [250, 700, 1500];

export function queueItemWrite<T extends { status: number }>(key: string, send: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    let res = await send();
    for (const ms of RETRY_MS) {
      if (res.status !== 409) break;          // 412 = someone else changed the item: do NOT retry
      await new Promise(r => setTimeout(r, ms));
      res = await send();
    }
    return res;
  };
  const prev = queues.get(key) || Promise.resolve();
  const next = prev.then(run, run);           // a failed write must not block the queue
  queues.set(key, next.catch(() => undefined));
  return next;
}

// every MERGE to a list item goes through it
queueItemWrite(`${listUrl}#${itemId}`, () => merge(listUrl, itemId, fields));
```

- **Key by item**, not by list: writes to different items should still run in parallel.
- **Retry only 409.** A 412 means a real competing change; retrying with `*` would overwrite it.
- **Return a result to the caller** for writes that hold state the user sees (a toggle, a choice) and tell the user when it was not saved, instead of a silent `void`.

## Where else to look

Any screen where one user action triggers two or more independent updates of the same record: a record card plus a counter, a preview plus metadata, "mark as read" plus "last opened". A unit test with a fake SharePoint that answers the second concurrent write with 409 catches the class; a manual click-through usually does not.

## See also

- [SharePoint REST has no increment](a-counter-written-from-a-stale-read-loses-votes.md) – the other half of `IF-MATCH: *`: a stale value overwrites newer ones.
