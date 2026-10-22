---
title: "`CreateCopyJobs`: the library root is refused, progress logs are handed out once, and `JobWarning` is not a failure"
short-title: "Copy job: library root, one-shot logs, harmless warnings"
summary: Passing a document library's root folder URL to CreateCopyJobs fails with HTTP 500 "Null value for source item" while a subfolder URL copies the folder with its content; GetCopyJobProgress returns only the log entries queued since the previous call, a job emits several JobStart/JobEnd pairs so JobEnd alone is not completion (JobState 0 is), a successful copy can carry a JobWarning about label based policy, and ListItemAllFields refuses $expand=Author
tags: [rest-api, migration, copy-job, monitoring, metadata]
applies-to: SharePoint Online
last-reviewed: 2026-10-22
---

# Copy job monitoring: four traps measured on one run

> **Bottom line.** To copy a whole library, do **not** pass the library root URL to
> `CreateCopyJobs` — it fails with HTTP 500 *"Null value for source item"*. Pass the top-level
> folders (a subfolder URL copies the folder with everything in it) and the root-level files one
> by one. When polling `GetCopyJobProgress`, **keep every batch of logs**: each call returns only
> what was queued since the last one. Treat the job as finished only when `JobState` is `0`, and
> do not count `JobWarning` as a failure.
>
> **Ve zkratce.** Celou knihovnu do `CreateCopyJobs` neposílejte adresou jejího kořene – úloha
> spadne na HTTP 500 *„Null value for source item“*. Pošlete nejvyšší složky (adresu podsložky
> úloha bere i s obsahem) a soubory z kořene jednotlivě. Při dotazování `GetCopyJobProgress`
> **schovávejte všechny dávky logu** – každé volání vrací jen to, co přibylo od minula. Hotovo je
> až při `JobState` 0 a `JobWarning` není chyba.

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

`TimeCreated`, `TimeLastModified`, `Author` and `ModifiedBy` matched the list item's `Created`,
`Modified`, `Author` and `Editor` on both the source and the copied file.

Related: [Copy and Move keeps versions, timestamps and authors](copy-and-move-keeps-versions-timestamps-and-authors.md).
