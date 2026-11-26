---
title: Sharing links survive overwrite and rename, but not "recycle and upload again"
short-title: "Sharing links: rename yes, re-upload no"
summary: "“Copy link” URLs resolve by the file's UniqueId – overwriting content (Files/add overwrite) or renaming (MoveTo) keeps them working, recycling the old file and uploading a new one breaks every link; readers get only “people with existing access” links"
tags: [rest-api, files, sharing, links]
applies-to: SharePoint Online
last-reviewed: 2026-11-26
---

# Sharing links survive overwrite and rename, but not "recycle and upload again"

> **Bottom line.** Links from **Copy link** resolve through the file's `UniqueId`. If your code publishes a new version of a document, **overwrite the same file and rename it with `MoveTo`** – links keep working. Recycling the old file and uploading a new one under a new name creates a new `UniqueId`, and every link people pasted into other documents, e-mails or Teams breaks.
>
> **Ve zkratce.** Odkazy z „Kopírovat odkaz“ se dohledávají podle `UniqueId` souboru. Nová verze dokumentu = přepsat tentýž soubor a přejmenovat přes `MoveTo`; odkazy fungují dál. „Starý do koše, nový nahrát“ dá nové `UniqueId` a rozbije všechny vložené odkazy.

## Measured (SharePoint Online, 2026-11)

| Operation | `UniqueId` | Existing link |
|---|---|---|
| `Files/add(url='x.docx',overwrite=true)` on the same name | unchanged (new version) | opens the file |
| `…/moveto(newurl='…/y.docx',flags=1)` | unchanged | opens the renamed file |
| recycle `x.docx`, upload `y.docx` | **new** | broken |

Two link shapes, both survive the rename:

- **Organization / specific-people link** (`/:w:/s/site/<token>`) – resolved via `/_api/v2.0/shares/u!<base64url>/driveItem`, which returned the new file name after the rename.
- **People with existing access** (`/:b:/r/sites/site/Library/<old path>?d=w<UniqueId-without-dashes>&…`) – even though it carries the **old path**, opening it after the rename redirected to `Doc.aspx?sourcedoc={UniqueId}` with the new name. The `d=` parameter wins over the path.

## Who can create which link

A user with read-only access (custom level without Manage Permissions) on a library where member sharing is off:

- the **Copy link** button in the library still works and produces a *people with existing access* link – it grants nothing new, so it is allowed;
- `ListItemAllFields/ShareLink` with `linkKind: 2` (organization view) → **403**; `linkKind: 1` (Direct) → 400 *"LinkKind cannot be Direct or Uninitialized"*;
- `/_api/v2.0/…/createLink` called with the browser session → 403 *"OAuth only flow is enabled and the call has not been issued from an app"*, whatever the scope.

So if your solution relies on people linking published documents to each other, the *existing access* link is the one they will have – and it survives a rename as long as the item stays the same.
