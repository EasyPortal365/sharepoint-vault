---
title: Migrating list items with original authors, dates — and their version history
short-title: List items with authors, dates and history
summary: Copy and Move does not do lists, but REST does the job item by item — `AddValidateUpdateItemUsingPath` takes Author, Editor, Created and Modified at creation (one call, one version), version history can be replayed with `ValidateUpdateListItem(bNewDocumentUpdate:false)`, approval goes in the same call, attachments add a version, and two field formats are dropped without any error
tags: [lists, migration, rest-api, metadata, authorship, versioning, content-approval]
applies-to: SharePoint Online
last-reviewed: 2026-10-27
---

# Migrating list items with original authors, dates — and their version history

> **Bottom line.** The Copy and Move API (`CreateCopyJobs`) handles files and folders only. For list items, create each one with `AddValidateUpdateItemUsingPath` and pass `Author`, `Editor`, `Created` and `Modified` in the same call — all four stick and the item has a single version. Older versions can be **replayed**: one `ValidateUpdateListItem` call per version with `bNewDocumentUpdate: false`, carrying that version's values plus its `Editor` and `Modified`. Times are kept to the minute, not the second. Always read the item back: two value formats are discarded with HTTP 200 and no error.
>
> **Ve zkratce.** Copy and Move API (`CreateCopyJobs`) umí jen soubory a složky. Položky seznamu se přenášejí po jedné: `AddValidateUpdateItemUsingPath` s `Author`, `Editor`, `Created` a `Modified` v témže volání – všechny čtyři drží a položka má jedinou verzi. Starší verze jde **přehrát**: za každou verzi jedno `ValidateUpdateListItem` s `bNewDocumentUpdate: false`, hodnotami té verze a jejím `Editor` a `Modified`. Časy drží na minutu, ne na vteřinu. Položku vždy přečíst zpátky: dva tvary hodnot se zahodí s HTTP 200 a bez chyby.

All results below were measured on 2026-10-27 on a custom list with versioning on (Czech locale, web time zone Pacific). The author and editor were deliberately a **different account** than the caller, so a match proves something. Every verdict comes from reading the item back, not from the response.

## Create with all four fields — one call, one version

```js
await fetch(`${web}/_api/web/GetList(@a)/AddValidateUpdateItemUsingPath?@a='${encodeURIComponent(listRel)}'`, {
  method: 'POST',
  headers: { Accept: 'application/json;odata=nometadata',
             'Content-Type': 'application/json;odata=nometadata', 'X-RequestDigest': digest },
  body: JSON.stringify({
    listItemCreateInfo: { FolderPath: { DecodedUrl: listRel }, UnderlyingObjectType: 0 },
    formValues: [
      { FieldName: 'Title',    FieldValue: 'Request 42' },
      { FieldName: 'Author',   FieldValue: JSON.stringify([{ Key: 'i:0#.f|membership|alice@contoso.com' }]) },
      { FieldName: 'Editor',   FieldValue: JSON.stringify([{ Key: 'i:0#.f|membership|alice@contoso.com' }]) },
      { FieldName: 'Created',  FieldValue: '4.3.2019 1:15' },   // web locale AND web time zone
      { FieldName: 'Modified', FieldValue: '19.7.2021 7:42' }
    ],
    bNewDocumentUpdate: false
  })
});
```

Read back: `AuthorId`, `EditorId`, `Created`, `Modified` all as sent, `OData__UIVersionString` `1.0`, and the single version carries the foreign editor. The date must be in the web's locale and time zone — see [Created/Modified on a document library](created-modified-on-a-document-library.md) for how to build it with `utctolocaltime`.

Creating a bare item first and then sending the four fields with `ValidateUpdateListItem` also works with `bNewDocumentUpdate: true`. With `false` you get a version 2.0, and version 1.0 keeps **the caller and today's time** in the history. Creating with all four at once avoids both.

## Version history can be replayed

1. Create the item with **version 1's** values and all four fields (`Modified` = `Created`).
2. For every later version, call `items(id)/ValidateUpdateListItem` with `bNewDocumentUpdate: false`, that version's field values, its `Editor` and its `Modified`.

Measured with three versions: the target shows 3.0, 2.0 and 1.0 with the right titles, the right editor on each (a different person on v2) and the right timestamps (to the minute). `Created By` and `Created` stay those of version 1. Send the timestamps in increasing order.

## Attachments add a version

`items(id)/AttachmentFiles/add(FileName='…')` creates a **new version** and stamps `Editor` and `Modified` with the caller and now. Sending all four fields again with `bNewDocumentUpdate: true` restores the values, but the extra version stays in the history (with the restored metadata). Upload attachments before the last replayed version, or accept one extra version.

## Content approval: approve in the same call

On a list with content approval, a new item is `_ModerationStatus` 2 (pending). Add `{ FieldName: '_ModerationStatus', FieldValue: '0' }` to the call that carries the four fields (`bNewDocumentUpdate: true`). The result is approved, the four fields hold, and there is still one version.

Do **not** approve with a `MERGE` on `OData__ModerationStatus`. It approves, but stamps `Editor`/`Modified` with the caller. When the four fields are sent afterwards to fix that, the item goes **back to pending** and gains a version.

## Value formats — and two that fail without a word

Each format was sent alone, because one rejected field cancels the whole update.

| field type | accepted | rejected |
|---|---|---|
| Number | `1,5` (the web's decimal separator) | `2.5` → `HasException` "Only numbers can go here." |
| DateTime | `6.5.2020 0:08` (web locale and zone) | ISO → "You must specify a valid date…" |
| MultiChoice | `A;#B`, `;#B;#C;#` | — |
| UserMulti | `[{"Key":"…"},{"Key":"…"}]` | — |
| Lookup | `1`, `2;#Title` | — |
| LookupMulti | `1;#;#2;#`, `2;#L2;#1;#L1` | ⚠ `1;#2` → **stores only the first value, no error** |
| URL | `https://…, description` | — |
| Boolean | `1`, `No` | ⚠ `Yes` → **stores No, no error** |

The two ⚠ rows look like success: HTTP 200, no `HasException`, a different value. Send Boolean as `1`/`0` and LookupMulti as `id;#;#id;#`. Compare the column values you read back with what you sent, not only the author and dates.

## Over the 5,000 list view threshold: writing is the same, reading is not

5,100 items created with all four fields from one browser at concurrency 4 took 550 s, about **560 items per minute**. There were seven `429` responses: after roughly 2,800 items SharePoint throttled for about two minutes (`Retry-After`), then continued at the same pace. No item failed. Creating items and replaying history past item 5,000 behaved exactly as on a small list.

Reading does change:

| query on 5,100 items | result |
|---|---|
| `$filter` on a non-indexed column (`Modified`, `Title`) | **500 `SPQueryThrottledException`** |
| `$filter=Id gt 4900 and Modified ge …` | **500** – an indexed first clause does not save it |
| `$orderby=Id asc&$top=5000` + `nextLink` | 200, pages fine |
| no `$filter`, `$top=5000` | 200 with `nextLink` |

Page by `Id` and filter in code. An incremental "since last run" mark works as `Id gt N`, but not as a `Modified` filter.

`ItemCount` on the list **does not keep up during a bulk write**: it read 87 when 637 items existed. Count what you wrote from your own run log (or `$orderby=Id desc&$top=1`), not from `ItemCount` right after writing.

## Rule

One item = one `AddValidateUpdateItemUsingPath` with the four fields (plus `_ModerationStatus` if needed). Replay older versions with `bNewDocumentUpdate: false`. Then read everything back. Expect minute precision and an extra version for each attachment step.
