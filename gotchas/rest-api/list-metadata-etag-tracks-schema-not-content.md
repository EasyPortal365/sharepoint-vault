---
title: A list's ETag tracks its schema, so `ItemCount` comes back stale via 304
tags: [rest-api, caching, spfx, lists]
applies-to: SharePoint Online (SPFx / any browser-side REST client)
last-reviewed: 2026-09-07
---

# A list's ETag tracks its schema, so `ItemCount` comes back stale via 304

> **Bottom line.** The ETag SharePoint returns for a *list entity* is the list's **schema** version, not a content version. Add a thousand items and it does not move — so the browser revalidates, gets `304 Not Modified`, and hands your code the body it stored back when the list was empty. Every read of `ItemCount`, `LastItemModifiedDate` or `LastItemUserModifiedDate` on `GetList(...)` / `lists(guid'...')` needs a cache-buster, even when no write of yours is involved.
>
> **Ve zkratce.** ETag, který SharePoint vrací u ENTITY seznamu, je verze jeho **schématu**, ne obsahu. Přidej tisíc položek a nezmění se – prohlížeč tedy revaliduje, dostane `304 Not Modified` a podstrčí kódu tělo uložené v době, kdy byl seznam prázdný. Každé čtení `ItemCount`, `LastItemModifiedDate` nebo `LastItemUserModifiedDate` z `GetList(...)` / `lists(guid'...')` potřebuje cache-buster – i když sám nic nezapisuješ.

## Symptom

A navigation badge shows no count for **Companies** while the list holds 24 rows. Its neighbour **Contacts** shows 25 correctly. Both are read by the same function, in the same loop, one line apart:

```js
GET /_api/web/GetList('/sites/projects/Lists/Companies')?$select=ItemCount   // → { "ItemCount": 0 }
```

Because a zero-count badge is usually hidden by a render guard, the failure looks like a design decision ("this one has no badge"), not a bug. The same shape hides in "0 files in this library" headers, in "the list is empty" empty-states, and in admin cards that report list contents.

Measured on one URL, in one moment, on the page itself:

```js
const u = "https://contoso.sharepoint.com/sites/projects/_api/web/GetList('/sites/projects/Lists/Companies')?$select=ItemCount";
await (await fetch(u, { headers: { Accept: 'application/json;odata=nometadata' } })).json();
// → { ItemCount: 0 }
await (await fetch(u, { cache: 'no-store', headers: { Accept: 'application/json;odata=nometadata' } })).json();
// → { ItemCount: 24 }
```

Both responses carry the **same** `ETag: "107"`.

## Cause

For a single list entity SharePoint answers with `Cache-Control: private, max-age=0` **and** an `ETag`. `max-age=0` means "revalidate before reuse", not "do not store" — so the browser keeps the body and, on the next read, sends `If-None-Match: "107"`.

That ETag is the list's **schema version**. Adding, editing or deleting items does not change it; adding a column or changing a field does. The server therefore answers `304 Not Modified` and the browser serves its stored body — the one captured when the list had just been provisioned and was empty.

This is why one list is right and its neighbour is wrong: the "working" list happened to get a column change that day, its ETag moved, and the revalidation returned a fresh body. Content written from anywhere else — a REST import from another tab, a colleague, a Power Automate flow — never touches that cache entry.

`performance.getEntriesByType('resource')` makes it visible: such a request shows `transferSize` around 300 B (a 304 carries no body) while `responseStatus` still reads 200.

## Fix

Bust the cache on every read of an entity property whose value changes without a schema change:

```ts
let seq = 0;
/** URL with a one-shot parameter, so the browser cannot serve it from cache. */
export function noCache(url: string): string {
  seq += 1;                                  // two reads in the same millisecond must differ
  return url + (url.indexOf('?') === -1 ? '?' : '&') + '_=' + Date.now() + '_' + seq;
}

const meta = await spGet<{ ItemCount: number }>(
  noCache(`${listApiBase(webUrl, 'Companies')}?$select=ItemCount`)
);
```

`cache: 'no-store'` on the `fetch` init does the same job for raw `fetch`; a URL parameter is the portable option when the request goes through a client wrapper that owns the init object (SPFx `SPHttpClient`, for instance).

## Notes

- **Which reads are affected.** Only *entity* reads: `GetList('<server-relative-url>')`, `lists(guid'...')`, `lists/getbytitle('...')`, and the same shape on a folder (`ItemCount` of `GetFolderByServerRelativeUrl(...)`). **Collections** — `/_api/web/lists?$select=...,ItemCount` — and item reads (`/items`) carry no entity ETag, so revalidation returns a fresh body and they are fine. That distinction is the whole discriminator; write it into a comment wherever you *deliberately* leave a collection read unbusted, or the next sweep "fixes" it again.
- **This is not the read-after-write trap** ([browser cache answers your read-after-write check](browser-cache-answers-your-read-after-write-check.md)). There, your own write is the trigger and the cure is the same. Here **no write of yours is needed at all** — a plain badge, refreshed on every page load, is wrong for as long as nobody changes the schema.
- **A stale count that drives a WRITE is the dangerous case.** "Is the list empty?" before seeding demo data, "create the default set", or a confirmation dialog that says *"deleting this will remove N threads"*: a cached zero turns into duplicated data or into a confirmation the user reads as safe. Reads on a write path must be strict *and* uncached — and a count that could not be read must be shown as unknown, never as zero.
- **Do not put the buster into your generic GET helper.** It would disable caching for ordinary list and item reads too. Bust the reads that verify or decide a write, plus the entity reads described here.
