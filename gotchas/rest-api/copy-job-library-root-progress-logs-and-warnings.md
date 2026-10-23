---
title: "`CreateCopyJobs`: the library root is refused, progress logs are handed out once, and `JobWarning` is not a failure"
short-title: "Copy job: library root, one-shot logs, harmless warnings"
summary: Passing a document library's root folder URL to CreateCopyJobs fails with HTTP 500 "Null value for source item" while a subfolder URL copies the folder with its content; several file names containing the hash sign break a multi-URI job with HTTP 400 unless it is sent as %23; GetCopyJobProgress returns only the log entries queued since the previous call, a job emits several JobStart/JobEnd pairs so JobEnd alone is not completion (JobState 0 is), a successful copy can carry a JobWarning about label based policy, ListItemAllFields refuses $expand=Author, and item-level unique permissions are not copied (IncludeItemPermissions fails with HTTP 500 on a copy) but can be re-applied afterwards without touching Modified, and every job must take URIs from one parent folder into a destination that already exists
tags: [rest-api, migration, copy-job, monitoring, metadata]
applies-to: SharePoint Online
last-reviewed: 2026-10-23
---

# Copy job monitoring: nine traps measured in two days

> **Bottom line.** To copy a whole library, do **not** pass the library root URL to
> `CreateCopyJobs` — it fails with HTTP 500 *"Null value for source item"*. Pass the top-level
> folders (a subfolder URL copies the folder with everything in it) and the root-level files one
> by one. When polling `GetCopyJobProgress`, **keep every batch of logs**: each call returns only
> what was queued since the last one. Treat the job as finished only when `JobState` is `0`, and
> do not count `JobWarning` as a failure. Item-level unique permissions do **not** travel with a
> copy; re-apply them afterwards – that does not change `Modified`.
>
> **Ve zkratce.** Celou knihovnu do `CreateCopyJobs` neposílejte adresou jejího kořene – úloha
> spadne na HTTP 500 *„Null value for source item“*. Pošlete nejvyšší složky (adresu podsložky
> úloha bere i s obsahem) a soubory z kořene jednotlivě. Při dotazování `GetCopyJobProgress`
> **schovávejte všechny dávky logu** – každé volání vrací jen to, co přibylo od minula. Hotovo je
> až při `JobState` 0 a `JobWarning` není chyba. Vlastní oprávnění položek kopie **nepřenese** –
> dopište je po kopii, datum změny se tím nepohne.

## 1. Library root vs. subfolder

| `exportObjectUris` | Result |
|---|---|
| `https://contoso.sharepoint.com/sites/a/Shared Documents` (library root) | HTTP 500, `SPMigrationQosException`, *"Null value for source item at &lt;ScrubbedUrl&gt;"* |
| `https://contoso.sharepoint.com/sites/a/Shared Documents/Folder` | job created, folder and its file arrive in the destination |

So "copy the whole library as one URI" is not available. Build the job from the top-level folders
plus the files that sit directly in the root.

## 2. Progress logs are dequeued

`POST /_api/site/GetCopyJobProgress` with `{ copyJobInfo }` returns `Logs` — but only the entries
queued since the previous call. A poller that keeps just the latest response loses
`ObjectError` entries reported earlier and ends up claiming that every item arrived.

```js
let raw = [];
for (;;) {
  const p = await post(web + '/_api/site/GetCopyJobProgress', { copyJobInfo: info });
  raw = raw.concat(p.Logs || []);          // accumulate — never replace
  if (p.JobState === 0) break;             // finished
  await sleep(5000);
}
```

## 3. `JobEnd` is per phase, `JobWarning` is noise

One successful folder copy produced this sequence:
`JobQueued, JobLogFileCreate, JobStart, JobEnd, JobLogFileCreate, JobStart, JobWarning, JobLogFileCreate, JobFinishedObjectInfo, JobEnd, JobStart, JobEnd`.

- `JobEnd` appears **three times** — the first one is not the end of the job. Use `JobState === 0`.
- The `JobWarning` said *"This tenant does not support label based policy"* and the copy was
  complete. Mark a job partial on `ObjectError`, not on `JobWarning`.

## 4. Reading Created By for verification

`GetFileByServerRelativePath(decodedurl=@p)/ListItemAllFields?$select=Author/Title&$expand=Author`
returns HTTP 400 *"The $expand query is not valid for field 'Author'"*. Read the **file** instead:

```
GET /_api/web/GetFileByServerRelativePath(decodedurl=@p)?@p='/sites/a/Lib/x.docx'
    &$select=TimeCreated,TimeLastModified,UIVersionLabel,Author/Title,ModifiedBy/Title
    &$expand=Author,ModifiedBy
```

`TimeCreated` and `TimeLastModified` match the list item's `Created` and `Modified` (within a
second, see section 6). **The file's `Author` is not always the item's Created By**, though: after a
plain `CopyTo`, the file's `Author` is whoever ran the copy, while the item's Created By keeps the
original person — and the copy job carries over the **item** value. Read the names from the item
without `$expand`:

```
GET /_api/web/GetFileByServerRelativePath(decodedurl=@p)/ListItemAllFields/FieldValuesAsText
    ?@p='/sites/a/Lib/x.docx'&$select=Author,Editor
```

Comparing the file's `Author` reported a mismatch on a copy that was in fact faithful.

## 5. `#` in file names: encode it as `%23`

The URI parser treats everything after `#` as a fragment. One file named `report #1-a.txt`
works, but five files `report #1-a.txt`, `report #1-b.txt`, … in **one** job collapse to the
same key and the whole call fails with HTTP 400 *"An item with the same key has already been
added"* (`System.ArgumentException`). Sending `#` as `%23` created the job and all 14 files —
five with `#`, one with `%` — arrived with their exact names. Keep `%` itself **raw**; only `#`
is encoded. Do not treat this 400 as "the endpoint is not supported" — it is a data error.

## 6. Times: what the job carries over, and a one-second jitter

- If a file's **Created** was rewritten after upload (for example with `ValidateUpdateListItem`),
  the copy gets the **original** creation time, not the rewritten one: source `08:35:00`
  (rewritten), fresh copy `08:35:49` (the upload time). Verification that compares Created will
  rightly flag it.
- `TimeLastModified` of the file and `Modified` of its list item can differ by **one second** on
  the very same source file (`08:36:07` vs `08:36:06`). Compare times with a tolerance of a couple
  of seconds, or you report mismatches that are not there.

## 7. `NameConflictBehavior`: what 0, 1 and 2 actually do

Measured with the same file copied into the same folder:

| Value | Result |
|---|---|
| `0` | `JobError` *"A file or folder with the name … already exists at the destination."* |
| `1` | Replaced **in place** – the destination keeps its list item ID and `UniqueId`; the content is the source's |
| `2` | Both kept – the copy is renamed by appending `1` to the base name, no space: `report.txt` → `report1.txt` |

There is no "skip" and no "only if newer". To offer those, read the destination first and leave the existing
(or not-newer) items out of `exportObjectUris`. `GetList('<url of a subfolder>')` resolves to the library, so the
same read works when the destination is a folder.

## 8. Item-level permissions are not copied – re-apply them afterwards

Three files were copied library to library in one site collection: one with unique permissions
(inheritance broken, Visitors: Read), one inheriting, one with unique permissions plus Visitors:
Contribute. In the destination **all three** had `HasUniqueRoleAssignments: false` and the
destination library's roles.

- `options.IncludeItemPermissions: true` (documented as *"Reserved for internal use only"*) on a
  copy fails with HTTP 500 `SPMigrationQosException` *"MoveAndShareFile scenario is not enabled for
  non-move operations"* – the job is not created.
- Re-applying permissions on the copied item – `ListItemAllFields/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)`
  and `roleassignments/addroleassignment(principalid=…,roledefid=…)` – left `TimeLastModified`,
  the item's `Modified`, the version label, Modified By and the **ETag** unchanged. Unlike writing a
  field value, a permission change does not bump the modification date.
- Principal IDs are scoped to the site collection: SharePoint groups of the source do not exist in
  another site collection, and users have to be resolved there (`ensureuser`) before
  `addroleassignment`.
- **Trap:** the associated Owners, Visitors and Members groups had the **same IDs (3, 4, 5) in two
  different site collections**. Code that copies the source `PrincipalId` "works" by accident and,
  in a collection created in a different order, grants rights to an unrelated group. Map a
  SharePoint group by its role (source associated Owner/Member/Visitor → the destination's group of
  the same kind), otherwise by name – never by ID.
- Across two site collections, `ensureuser` in the destination with the source `LoginName` returned
  200 for a user (`i:0#.f|membership|…`) and for a security group (`c:0t.c|tenant|…`); both got new
  IDs there. `PrincipalType`: 1 user, 4 security or Microsoft 365 group, 8 SharePoint group. Skip
  hidden roles (`Limited Access`, `Web-Only Limited Access`) and the `Limited Access System Group`;
  map roles by `RoleTypeKind` (2 Read, 3 Contribute, 4 Design, 5 Full Control, 6 Edit), custom
  roles (0) by name.
- `breakroleinheritance(copyRoleAssignments=false)` leaves only **the caller**, with Full Control
  (a site collection admin too). After adding the source roles, remove yourself with
  `roleassignments/getbyprincipalid(<your id>)/deleteobject()`, or the copy silently gains an extra
  principal. The final set then matched the source exactly, and `Modified` and the ETag were still
  unchanged.

## 9. One parent per job, and the destination folder must exist

- A job whose `exportObjectUris` came from two folder levels (files from a subfolder plus a file
  from the library root) failed with HTTP 500 `SPMigrationQosException` *"Objects to copy or move
  do not come from the same level of the parent object."* Nothing was copied. Group item URIs by
  their parent folder and send one job per group.
- Sending every file to the library root is the other half of the trap: a file from `A/B/x.txt`
  lands as `x.txt` in the destination root. Point each group at the matching subfolder of the
  destination instead.
- A `destinationUri` that does not exist yet fails at job creation with HTTP 500 *"Failed to verify
  the existence of destination location"*. Create the folders first – **one level at a time**:
  `web/folders/AddUsingPath` with two missing levels returns 500, while
  `GetFolderByServerRelativePath(parent)/Folders/AddUsingPath(decodedurl='name')` returns 200. An
  existing folder returns **400** "already exists", so check `?$select=Exists` first (it returns
  `{ "Exists": false }` with 200 for a missing folder). In PnP PowerShell, `Resolve-PnPFolder` does
  both.

Related: [Copy and Move keeps versions, timestamps and authors](copy-and-move-keeps-versions-timestamps-and-authors.md).
