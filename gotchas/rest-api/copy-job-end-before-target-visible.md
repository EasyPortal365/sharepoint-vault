---
title: A copy job reports "finished" before the target shows every file – verify after the target settles, and read authors with $expand
short-title: Copy job ends before the target is visible
summary: "After CreateCopyJobs reports JobState 0, the target's /items can still miss hundreds of files for a while; re-read until two reads match, and compare authors via $expand on /items, not siteusers"
tags: [rest-api, copy-move, migration, verification]
applies-to: SharePoint Online
last-reviewed: 2026-10-31
---

# A copy job reports "finished" before the target shows every file – verify after the target settles, and read authors with $expand

> **Bottom line.** When `GetCopyJobProgress` reports the job as finished (`JobState` 0), the target library's `/items` does not necessarily return every copied file yet. A verification that reads the target once, right after the job ends, can report hundreds of files as missing from a transfer that is complete a few minutes later. Re-read the target (with a cache buster) until all expected items are found or two reads in a row return the same count and size, with a cap; after the cap, report "unknown", never "missing". For authorship, the authors of copied files are often not in the target site's `siteusers`, so `AuthorId` cannot be resolved there – read `Author`/`Editor` with `$expand` on `/items` and compare by login or e-mail.
>
> **Ve zkratce.** Když `GetCopyJobProgress` hlásí konec úlohy (`JobState` 0), `/items` cílové knihovny ještě nemusí vracet všechny zkopírované soubory. Ověření, které cíl přečte jednou hned po konci, umí u přenosu, který je za pár minut celý, nahlásit stovky „chybějících“ souborů. Cíl čti opakovaně (s obejitím cache), dokud nejsou nalezené všechny očekávané položky nebo dvě čtení po sobě nedají stejný počet a objem, se stropem; po stropu hlas „nezjištěno“, nikdy „chybí“. Autory zkopírovaných souborů často v `siteusers` cílového webu nenajdeš, takže `AuthorId` tam nepřeložíš – čti `Author`/`Editor` přes `$expand` na `/items` a porovnávej loginem nebo e-mailem.

## Symptom

A library of 794 files in 28 folders was copied with `CreateCopyJobs` into a new site. The job finished without errors. A verification that ran immediately afterwards read the target library and found 202 of 794 files: "592 missing". A few minutes later the target held all 794 files with their history – the transfer had been fine.

In the same check, comparing Created By / Modified By through `AuthorId`/`EditorId` and the target site's user table returned "not determined" for the copied files: `getuserbyid(<id>)` on the target web did not find the user.

## Cause

- The end of the job and the moment the copied items are visible through REST are not the same moment. The target keeps materializing for a while after `JobState` reaches 0. A single read at that time is a random snapshot.
- The copied item keeps its original author, but that person is not necessarily added to the target site's user information list, so an Id-based lookup through `siteusers`/`getuserbyid` fails.

## Fix

Re-read until the target settles:

```ts
// expected = paths of the items this run sent; read() returns { [lowerPath]: size } for the target
let prev: { found: number; bytes: number } | null = null;
const t0 = Date.now();
for (;;) {
  const map = await read();                       // page with odata.nextLink, add a cache buster
  const cur = countFound(expected, map);          // how many expected paths are there, and their size
  if (cur.found === expected.length) break;       // all there – nothing to wait for
  if (prev && prev.found === cur.found && prev.bytes === cur.bytes) break; // settled
  if (Date.now() - t0 > 10 * 60 * 1000) { /* report "unknown", not "missing" */ break; }
  prev = cur;
  await new Promise(r => setTimeout(r, 20000));
}
```

Read people with the item, not through the user table:

```
GET {web}/_api/web/GetList(@a)/items?$select=Id,FileRef,Author/Title,Author/EMail,Author/Name,Editor/Title,Editor/EMail,Editor/Name&$expand=Author,Editor&@a='/sites/x/Shared Documents'
```

`Name` is the claims login (`i:0#.f|membership|user@contoso.com`). Strip the prefix and compare logins (or e-mails); never compare numeric user Ids across sites. `$expand=Author` works on `/items`; the 400 "The $expand query is not valid for field 'Author'" applies to a file's `ListItemAllFields`, not to the list's `/items`.

## Notes

- Observed on SharePoint Online on 31 October 2026 (copy job finish vs. target count) and measured the same day (`$expand` on `/items` in a library and in a list).
- The size of the lag depends on the tenant and the transfer; do not hard-code a single delay – wait for the count to stop changing.
