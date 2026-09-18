---
title: A batch file move must be grouped by file, not by the record that points at it
tags: [rest-api, files, idempotence, data-integrity, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-09-18
---

# A batch file move must be grouped by file, not by the record that points at it

> **Bottom line.** When several list items store the same file URL, a loop that moves "each item's file" moves the file once and then 404s on every sibling — leaving their links pointing at a path that no longer exists. Group the batch by file URL, move once, and write the new URL to every record that pointed at it.
>
> **Ve zkratce.** Když stejnou cestu k souboru nese víc položek seznamu, smyčka „přesuň soubor každé položky" přesune soubor jednou a u zbytku dostane 404 – a jejich odkazy zůstanou viset na cestě, která už neexistuje. Seskup dávku podle souboru, přesuň jednou a novou adresu zapiš všem záznamům, které na něj ukazovaly.

## Symptom

A bulk operation that relocates files (into a folder with unique permissions, into an archive folder, into a per-year structure) reports something like *"5 of them could not be moved"* — yet the destination folder exists, is correctly secured, and the file is sitting in it. The records left behind still carry the **old** path, so the UI shows a normal-looking document whose link 404s when a user clicks it.

Re-running the operation does not help: it fails on exactly the same records, with exactly the same count.

## Cause

The loop iterates **records**, and the relation record → file is not 1:1:

```ts
for (const item of items) {
  const target = `${folderUrl}/${leaf(item.fileUrl)}`;
  const r = await post(`.../getfilebyserverrelativeurl('${item.fileUrl}')/moveto(newurl='${target}',flags=1)`);
  if (!r.ok) { failed.push(item.fileUrl); continue; }   // <-- every sibling lands here
  await writeBackUrl(item.id, target);
}
```

The first record moves the file and gets its URL rewritten. For every other record pointing at the same file, the **source** path is now empty, so `moveto` answers 404 and the code — quite reasonably — calls that a failure. Nothing rewrites those records, and nothing ever will: the next run starts from the same stale URLs.

Two things make this easy to miss in review:

* **`flags=1` (overwrite) does not help.** The overwrite flag is about the *destination*; the request fails on the missing *source*.
* **A "is it already in place?" guard does not catch it either**, because that guard is evaluated against the record's **stored** path, which still points at the old location. The siblings genuinely look like work that still needs doing.

Anywhere the same shape appears — one file referenced by several records (a revision chain over one attachment, sample data, a satellite record, a copied row) — the batch produces *N−1* failures and the same number of orphaned links.

## Fix

**1. Group the batch by file URL. Move once, write back to all.**

```ts
const order: string[] = [];
const byFile: Record<string, number[]> = {};
for (const it of items) {
  if (!it.fileUrl) { noFile.push(it.id); continue; }
  if (!byFile[it.fileUrl]) { byFile[it.fileUrl] = []; order.push(it.fileUrl); }
  byFile[it.fileUrl].push(it.id);
}

for (const url of order) {
  const ids = byFile[url];
  const target = `${folderUrl}/${leaf(url)}`;
  const r = await post(`.../getfilebyserverrelativeurl('${url}')/moveto(newurl='${target}',flags=1)`);
  let moved = r.ok;
  ...
  for (const id of ids) await writeBackUrl(id, target);   // every record, not just one
}
```

**2. Let the second run adopt a file that is already at the destination.** A failing source is not proof that the operation failed — the path can be empty *precisely because* an earlier run moved the file and then died before writing the links. So when `moveto` fails, check the destination before declaring failure:

```ts
if (!moved) {
  const atTarget = await fileExists(target);   // three states: yes / no / unknown
  if (atTarget !== true) { failed.push(url); blocked.push(...ids); continue; }
  // adopt: the file is where it belongs, only the links are stale
}
```

This is what turns a broken half-run into something the user can repair by pressing Save again, instead of something an admin has to fix by hand in SharePoint.

**3. Make the existence check fail-closed.** `fileExists` must distinguish "no" from "could not tell" (403, throttling, network) and treat the latter as "no". Otherwise a read failure makes the code write a link to a file that may not be there — trading a visible error for an invisible one.

```ts
async function fileExists(url: string): Promise<boolean | undefined> {
  const r = await getJson<{ Exists?: boolean }>(
    `.../getfilebyserverrelativeurl('${esc(url)}')?$select=Exists`);
  if (r.status === 404) return false;
  if (!r.ok) return undefined;                       // do not guess
  return typeof r.data?.Exists === 'boolean' ? r.data.Exists : undefined;
}
```

**4. Do not merge "moved" and "repaired" into one counter.** They are different events: one relocated a file, the other only fixed links. A single number turns the result message into an impression rather than a report — and the difference is exactly what tells an admin whether an earlier run had died halfway.

## Related

* [Get lists by URL, not by title](get-list-by-url-not-by-title.md) — the same instinct applied to lists: address the thing, not a label that can change.
* [A silently-failed read turns reconciliation into delete-everything](silent-read-failure-drives-delete-all.md) — the other half of the rule: never let "I could not read it" become "there is nothing there".
