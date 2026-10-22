---
title: "`CreateCopyJobs` with `MoveButKeepSource` keeps version history, timestamps and authorship — and how to actually prove it"
short-title: "Copy and Move keeps versions, timestamps and authors"
summary: The server-side Copy and Move job preserves all versions, Created/Modified and Created By/Modified By, leaves the source in place, and is callable from the browser under delegated auth; two options are mandatory or the job refuses, and a lower version limit on the destination truncates history after the transfer
tags: [rest-api, migration, metadata, versions, authorship, lists]
applies-to: SharePoint Online
last-reviewed: 2026-10-22
---

# Copy and Move: what survives a transfer, and the trap in proving it

> **Bottom line.** `POST /_api/site/CreateCopyJobs` with `IsMoveMode: true` **and**
> `MoveButKeepSource: true` copies a file with its **whole version history**, its original
> `Created`/`Modified` **to the second**, and its original `Created By`/`Modified By` — while
> leaving the source untouched. It works from the browser under the signed-in user. But you
> cannot prove the authorship part on a file you created yourself: give the source a different
> author first, or the result tells you nothing.
>
> **Ve zkratce.** `POST /_api/site/CreateCopyJobs` s `IsMoveMode: true` **a**
> `MoveButKeepSource: true` přenese soubor s **celou historií verzí**, s původními časy
> `Created`/`Modified` **na vteřinu** a s původním `Created By`/`Modified By` – a originál
> nechá na místě. Z prohlížeče to jde pod přihlášeným uživatelem. Autorství ale nedokážete na
> souboru, který jste vytvořili sami: zdroji nejdřív nastavte jiného autora, jinak výsledek
> neříká nic.

## Why you would reach for this

An ordinary copy (`CopyTo`, drag and drop, most scripts) takes the **current version only** and
stamps the new file with **your** name and **today**. For a library reorganisation — new
information architecture, documents moving to a better-designed library — that destroys exactly
the metadata people rely on. The server-side migration job keeps it.

## The call

```js
const job = await post(`${web}/_api/site/CreateCopyJobs`, {
  exportObjectUris: [`${origin}/sites/<site>/<SourceLibrary>/<file>.docx`],
  destinationUri:   `${origin}/sites/<site>/<TargetLibrary>`,
  options: {
    IsMoveMode: true,                            // MoveButKeepSource is a MOVE mode that deletes nothing
    MoveButKeepSource: true,                     // the whole point: history + metadata, source stays
    IgnoreVersionHistory: false,
    AllowSchemaMismatch: true,                   // REQUIRED when the target columns differ
    AllowSmallerVersionLimitOnDestination: true, // REQUIRED when the target has a version policy
    NameConflictBehavior: 0,                     // 0 = fail on conflict, so a repeated run is visible
    BypassSharedLock: false,
    ExcludeChildren: false
  }
});
// then poll until JobState === 0
const info = job.value[0];
const progress = await post(`${web}/_api/site/GetCopyJobProgress`, { copyJobInfo: info });
```

Two things that cost time if you skip them:

- **`AllowSchemaMismatch` and `AllowSmallerVersionLimitOnDestination` are not optional** in
  practice. Without them the job refuses a target whose columns or version policy differ from
  the source — which is nearly always, since the target is usually a freshly designed library.
- `GetCopyJobProgress` returns `Logs` as an array of **JSON strings**, not objects, and
  `JobState: 0` means *finished*, not *not started*. Parse each log line and read `JobEnd` for
  `TotalErrors` / `TotalWarnings`.

It is callable with `odata=nometadata` from a normal page under delegated auth — no app-only
token, no tenant admin. (The endpoint is barely documented, so measure rather than assume.)

## Measured

A file with six versions, transferred within one site collection:

| | result |
|---|---|
| versions on target | **6, same labels** (1.0–5.0 + current) |
| `Created` / `Modified` | identical to the source **to the second** |
| `Created By` / `Modified By` | **preserved** (see the trap below) |
| source afterwards | still there, untouched |

That these are preserved rather than freshly stamped is clear from the gap: the job ran several
seconds after the source was created, and the target carries the source's creation time.

## The trap: you cannot prove authorship on your own file

The obvious test — copy a file and compare author names — proves nothing when **you** created
the source, because the author you would expect from a rewrite (you) and the author you expect
from preservation (you) are the same name. This looked "verified" for weeks and was not.

The honest test needs the source to belong to **someone other than the caller**:

1. upload the file as yourself;
2. set its `Author` **and** `Editor` to a different user, and its `Created`/`Modified` to a date
   in the past — all four fields in one `ValidateUpdateListItem` call with
   `bNewDocumentUpdate: true`; a `MERGE` silently refuses these, and `Author` sent on its own is
   dropped without a word (see *Created/Modified on a document library*);
3. read the source back and confirm the foreign author actually stuck;
4. run the copy job **as yourself**, not as that other user;
5. read the target.

Measured this way: source `Created 2019-03-04T09:15:00Z`, `Modified 2021-07-19T14:42:00Z`, both
author fields a different user; target came back with all four identical. Had the job rewritten
authorship, the target would have named the account that started the copy.

## Known limits

- **Permissions do not travel.** The job moves content and metadata, not role assignments.
- **A lower version limit on the destination truncates history** — and *after* the transfer: a
  source with 6 versions arrived complete and was then cut to 4 by the target library's policy.
  Set the target's version policy **before** the run, not after.
- Per-job ceilings apply (file count and total size), so large libraries need batching.
- `StorageMetrics` on the source may answer all zeros even for a library that has items, so do
  not read zero as "empty" when sizing a transfer.

## Rule

For anything that has to arrive with its history intact, use the server-side job rather than
copying bytes yourself — and when you verify that metadata survived, make sure the expected
value and the failure value are **different**, or the check cannot fail and therefore proves
nothing.
