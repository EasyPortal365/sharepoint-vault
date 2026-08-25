---
title: "Dropping a folder onto your upload zone does nothing (dataTransfer.files never sees it)"
tags: [spfx, drag-and-drop, upload, dataTransfer, file-system-access, browser-api]
applies-to: SharePoint Online (SPFx web parts and extensions, any browser-based upload UI)
last-reviewed: 2026-08-25
---

# Dropping a folder onto your upload zone does nothing

> **Bottom line.** `dataTransfer.files` only ever contains files — a dropped folder is invisible to it. The folder tree is available exclusively through `DataTransferItem.webkitGetAsEntry()`, and that collection is valid **only synchronously inside the `drop` handler**: one `await` and `dataTransfer.items` is empty. On top of that, `FileSystemDirectoryReader.readEntries()` returns the folder contents **in batches** (100 at a time in Chrome) and must be called repeatedly until it returns an empty array.
>
> **Ve zkratce.** `dataTransfer.files` obsahuje jen soubory – přetaženou složku nevidí. Strom vydá jedině `DataTransferItem.webkitGetAsEntry()` a ten je platný **jen synchronně v obsluze `drop`**: po prvním `await` je `dataTransfer.items` prázdné. A `readEntries()` vrací obsah po dávkách (v Chrome po 100), takže se musí volat opakovaně, dokud nevrátí prázdné pole.

## Symptom

Your drop zone handles files perfectly. A user drags a **folder** onto it and:

- nothing happens at all, or
- a single zero-byte entry appears with the folder's name, or
- (once you switch to the entries API) the first 100 files upload and the rest disappear without a single error in the console.

## Cause

Three independent traps stack on top of each other.

**1. `dataTransfer.files` has no concept of a directory.** The `FileList` a drop event hands you contains files only. A dropped folder either does not appear at all or surfaces as an entry with no readable content. There is no flag to turn this on — the folder structure lives in a different API.

**2. `dataTransfer.items` is only valid synchronously.** The entries API is reached through `dataTransfer.items[i].webkitGetAsEntry()`. But `DataTransfer` is neutered as soon as the event handler yields: after the first `await` (or inside a `.then` callback) `items.length` is `0`. Since walking a directory tree is inherently asynchronous, the natural-looking code

```ts
onDrop={async e => {
  e.preventDefault();
  const files = await collect(e.dataTransfer);   // ❌ too late already
}}
```

reads an empty collection — and it fails *silently*, which is why this costs hours.

**3. `readEntries()` is batched.** `FileSystemDirectoryReader.readEntries()` does not return the whole directory. Chrome returns up to 100 entries per call; you must keep calling it until it yields an empty array. A single call works fine while testing with a small folder and truncates in production.

## Fix

Pull every entry out **synchronously first**, then walk the tree:

```ts
export interface IDroppedFile { file: File; relPath: string }

export function collectDroppedFiles(dt: DataTransfer | null): Promise<IDroppedFile[]> {
  const entries: FileSystemEntry[] = [];
  const plain: File[] = [];

  // ⚠ SYNCHRONOUS part — dt.items is empty after the first await.
  const items = dt && dt.items;
  for (let i = 0; items && i < items.length; i++) {
    const it = items[i];
    if (it.kind !== 'file') continue;
    const entry = it.webkitGetAsEntry ? it.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else { const f = it.getAsFile(); if (f) plain.push(f); }   // older browsers
  }

  const out: IDroppedFile[] = plain.map(f => ({ file: f, relPath: '' }));
  const walk = async (entry: any, relPath: string, depth: number): Promise<void> => {
    if (out.length >= LIMIT || depth > MAX_DEPTH) return;
    if (entry.isFile) {
      const f = await new Promise<File | null>(res => entry.file((x: File) => res(x), () => res(null)));
      if (f) out.push({ file: f, relPath });
      return;
    }
    const reader = entry.createReader();
    const child = relPath ? relPath + '/' + entry.name : entry.name;
    for (;;) {
      // ⚠ BATCHED — keep reading until an empty batch comes back.
      const batch: any[] = await new Promise(res => reader.readEntries((b: any[]) => res(b || []), () => res([])));
      if (!batch.length) return;
      for (const child2 of batch) await walk(child2, child, depth + 1);
    }
  };

  return (async () => {
    for (const e of entries) await walk(e, '', 0);
    return out;
  })();
}
```

Two design points that keep the rest of the code simple:

- **Carry `relPath` on every file**, not as a separate tree. The upload queue then only has to create the missing folder before each file — no traversal logic downstream.
- **Cap the count and the depth, and tell the user when you truncated.** Symlink loops exist, and 10 000 files in a single drop will not finish. Silently taking the first N reads to the user as "everything uploaded".

On the SharePoint side, create the folders one level at a time (`/_api/web/folders/addUsingPath(DecodedUrl='…')` does **not** create intermediate folders) and treat "already exists" as success — that keeps the operation idempotent when two files share a folder:

```ts
for (const seg of relPath.split('/')) {
  cur = cur + '/' + cleanFolderName(seg);
  try { await post(`${web}/_api/web/folders/addUsingPath(DecodedUrl='${cur.replace(/'/g, "''")}')`); }
  catch (e) { if (!/already exists|HTTP 400/i.test(String(e))) throw e; }
}
```

Sanitize the folder name with **one shared helper** used both when creating the folder and when asking "does a file of this name already exist there" (`getfilebyserverrelativeurl('…')/Exists`). If the two paths are cleaned differently, the conflict check silently queries a different folder than the one you upload into — a folder name containing `#` or `%` is enough to trigger it.

## Checklist

- [ ] Entries pulled out of `dataTransfer.items` **before** any `await`.
- [ ] `readEntries()` called in a loop until it returns an empty batch.
- [ ] Fallback to `dataTransfer.files` when `webkitGetAsEntry` is unavailable.
- [ ] File-count and depth caps, with the truncation surfaced in the UI.
- [ ] Folders created one level at a time; "already exists" treated as success.
- [ ] One shared path-sanitizing helper for both folder creation and existence checks.

## References

- MDN: [`DataTransferItem.webkitGetAsEntry()`](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry)
- MDN: [`FileSystemDirectoryReader.readEntries()`](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryReader/readEntries)
- SharePoint REST: `Web/Folders/AddUsingPath`
