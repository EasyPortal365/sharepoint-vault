---
title: "`CreateCopyJobs` with `MoveButKeepSource` keeps version history, timestamps and authorship — and how to actually prove it"
short-title: "Copy and Move keeps versions, timestamps and authors"
summary: The server-side Copy and Move job preserves all versions, Created/Modified and Created By/Modified By, leaves the source in place, and is callable from the browser under delegated auth; omitting AllowSchemaMismatch is an immediate 500, a lower version limit on the destination truncates history after the transfer, and — measured — a plain CopyTo loses the version history but keeps the author
tags: [rest-api, migration, metadata, versions, authorship, lists]
applies-to: SharePoint Online
last-reviewed: 2026-10-25
---

# Copy and Move: what survives a transfer, and the trap in proving it

> **Bottom line.** `POST /_api/site/CreateCopyJobs` with `IsMoveMode: true` **and**
> `MoveButKeepSource: true` copies a file with its **whole version history**, its original
> `Created`/`Modified` **to the second**, and its original `Created By`/`Modified By` — while
> leaving the source untouched. A plain `CopyTo` keeps the author and the creation date but
> **loses the version history**, so history is the reason to use the job. And you cannot prove
> the authorship part on a file you created yourself: give the source a different author first,
> or the result tells you nothing.
>
> **Ve zkratce.** `POST /_api/site/CreateCopyJobs` s `IsMoveMode: true` **a**
> `MoveButKeepSource: true` přenese soubor s **celou historií verzí**, s původními časy
> `Created`/`Modified` **na vteřinu** a s původním `Created By`/`Modified By` – a originál
> nechá na místě. Obyčejné `CopyTo` autora i datum vzniku zachová, ale **historii verzí
> ztratí** – právě kvůli historii se úloha používá. Autorství navíc nedokážete na souboru,
> který jste vytvořili sami: zdroji nejdřív nastavte jiného autora, jinak výsledek neříká nic.

## Why you would reach for this — and what an ordinary copy actually does

`CopyTo` is usually described as the thing that "loses the metadata". Half of that is right, and
the half that is wrong is worth knowing. Measured side by side on one file with three versions
and a deliberately foreign author:

| | `CopyTo` | copy job |
|---|---|---|
| version history | **0 of 3 — lost** | 3 of 3 |
| `Created` | preserved | preserved |
| `Created By` | **preserved** | preserved |

So the reason to reach for the migration job is the **version history**, not the authorship:
within a site collection `CopyTo` kept both the original author and the original creation date.
If you have been avoiding `CopyTo` because it "rewrites the author", check it on your own tenant
before building around that belief — ours did not. (Measured within one site collection; across
site collections or tenants it was not measured.)

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

- **`AllowSchemaMismatch` is not optional** once the target's columns differ from the source's.
  Dropping it (and `AllowSmallerVersionLimitOnDestination`) produced an immediate **HTTP 500**,
  and the message is unusually helpful:

  > `Missing or mismatched field definition on the destination list for source field
  > 'ProjectCode' type 'Text'. … Total blocked root objects in this operation is [1].`

  (`ProjectCode` stands for whatever source column the target library does not have.)

  A freshly designed target library almost never matches the source, so in practice both flags
  belong in every call.
- `GetCopyJobProgress` returns `Logs` as an array of **JSON strings**, not objects, and
  `JobState: 0` means *finished*, not *not started*. Parse each log line and read `JobEnd` for
  `TotalErrors` / `TotalWarnings`.

It is callable with `odata=nometadata` from a normal page under delegated auth — no app-only
token needed. The endpoint is barely documented, so measure rather than assume.

**Minimum permissions (measured):** you do **not** need to be a site collection administrator.
With an account that was not a site admin on either site, and libraries with unique permissions
granted only to that account:

| Source library | Destination library | Result |
|---|---|---|
| Read | Contribute | OK — file arrives |
| Contribute | Contribute | OK |
| Contribute | Read | **HTTP 500**, *"You do not have permission to perform this action"* — the job is never created |
| Full Control | Full Control | OK |
| Read (plain copy, no `IsMoveMode`) | Contribute | OK |

So the floor is **Read on the source, Contribute on the destination**. Two things to plan for:
a missing right on the destination comes back as a **500**, not a 403 — do not treat it as a
service outage; and Contribute cannot change the destination library's settings (setting
`MajorVersionLimit` answers 403), so the "align the version limit before the run" step below
needs Full Control on the destination library.

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

Measured:

- **A lower version limit on the destination truncates history** — and *after* the transfer: a
  source with 6 versions arrived complete and was then cut to 4 by the target library's policy.
  Set the target's version policy **before** the run, not after.
- `StorageMetrics` on the source may answer all zeros even for a library that has items, so do
  not read zero as "empty" when sizing a transfer.
- **Names containing `#` or `%` transfer fine** — and `exportObjectUris` wants the **raw**,
  unencoded path (`…/discount 50% final.txt`), not `%25`. It looks like an invalid URI and it
  works on the first try.

  Note the contrast with *Hash and percent in file names need the ResourcePath API*: to
  **address** such a file you need `…ByServerRelativePath(decodedurl=…)` with the path
  URL-encoded, but to **name it inside the copy job's payload** you pass it raw. Different
  parameter, opposite rule — encoding it for the job is the mistake to avoid.

Not measured here, so verify before you rely on them:

- **Permissions are not expected to travel** — the job is documented as moving content and
  metadata, not role assignments. We did not test it.
- Per-job ceilings on file count and total size are Microsoft's documented limits, so large
  libraries need batching.

## Rule

For anything that has to arrive with its history intact, use the server-side job rather than
copying bytes yourself — and when you verify that metadata survived, make sure the expected
value and the failure value are **different**, or the check cannot fail and therefore proves
nothing.
