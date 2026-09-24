---
title: A `#` or `%` in a file or folder name — the classic `…Url` APIs cannot reach it, and the old writes quietly save `%25`
tags: [rest-api, files, folders, url-encoding, resourcepath, silent-data-loss]
applies-to: SharePoint Online REST (any client that builds `/_api/web/…` URLs by hand, SPFx included)
last-reviewed: 2026-09-24
---

# A `#` or `%` in a file or folder name — the classic `…Url` APIs cannot reach it, and the old writes quietly save `%25`

> **Bottom line.** SharePoint Online allows `#` and `%` in file and folder names, but the string-based "Url" APIs — `GetFileByServerRelativeUrl`, `GetFolderByServerRelativeUrl`, `Files/add(url=…)`, `folders/add(…)`, `moveto`, `copyto` — cannot address such an item, whether you encode the path or not. Worse, some of them answer **200** and create a *different* name with a literal `%25` in it, and the folder lookup answers `Exists: false` for a folder that exists. Use the ResourcePath API (`…ByServerRelativePath(decodedurl=…)`, `…UsingPath(DecodedUrl=…)`) — and still URL-encode the decoded path, after doubling apostrophes.
>
> **Ve zkratce.** SharePoint Online povoluje `#` a `%` v názvech souborů a složek, ale řetězcová „Url“ API – `GetFileByServerRelativeUrl`, `GetFolderByServerRelativeUrl`, `Files/add(url=…)`, `folders/add(…)`, `moveto`, `copyto` – na takovou položku nedosáhnou, ať cestu zakóduješ, nebo ne. Hůř: některá vrátí **200** a založí *jiné* jméno s doslovným `%25` a dotaz na složku vrátí `Exists: false` u složky, která existuje. Použij ResourcePath API (`…ByServerRelativePath(decodedurl=…)`, `…UsingPath(DecodedUrl=…)`) – a dekódovanou cestu pro URL stejně zakóduj, až po zdvojení apostrofů.

## Symptom

People name files and folders, and `#` and `%` are ordinary characters for them: `Invoice #12.pdf`, `Discount 20%.docx`, `Q3 #2 review`.

- A file that is plainly in the library "does not exist": **404** for the one with `#`, **400** (or 404) for the one with `%` — and 404 even for `plain.txt` when only its *folder* has a `#` or `%` in the name.
- A folder existence check says `Exists: false` about a folder that exists, so the code creates a second one.
- Files and folders appear with `%25` in their names after an upload, a folder creation, a move or a copy — and nothing reported an error.

## Measured

SharePoint Online, 24 September 2026, plain `fetch` from a browser tab, apostrophes always doubled. Files `t-amp & b.txt`, `t-plus + b.txt`, `t-apos o'b.txt`, `t-hash # b.txt`, `t-pct 50% b.txt` in a plain folder, and the same set inside a folder named `f #1 & 50% + o'k`.

**Reading a file**

| Call | `&`, `+`, `'` | `#` | `%` |
|---|---|---|---|
| `GetFileByServerRelativeUrl('…')`, raw | 200 | 404 | 400 |
| same, path through `encodeURI` or `encodeURIComponent` | 200 | 404 | 404 |
| `GetFileByServerRelativePath(decodedurl='…')`, raw | 200 | 404 | 400 |
| `GetFileByServerRelativePath(decodedurl='…')`, path through `encodeURIComponent` | 200 | 200 | 200 |

Inside the folder `f #1 & 50% + o'k`, every file — `t-plain.txt` included — returned 404 on every variant except the last one, which returned 200 for all of them.

**Looking up that folder**

| Call | Result |
|---|---|
| `GetFolderByServerRelativeUrl('…')`, raw | 404 |
| `GetFolderByServerRelativeUrl('…')`, encoded | **200 `{"Exists": false, "Name": "f #1 & 50%25 + o'k"}`** |
| `GetFolderByServerRelativePath(decodedurl='…')`, encoded | 200 `{"Exists": true}` |

**Writing**

| Call | Result |
|---|---|
| `Files/add(url='…')` with `&` or `+` | 200 |
| `Files/add(url='…')` with `#`: raw / encoded | 404 / 200 |
| `Files/add(url='…')` with `%`: raw / encoded | 400 / **200, but the file is saved as `u-pct 50%25 b.txt`** |
| `folders/add('…')`, encoded | **200, folder saved as `fa #1 50%25 o'k`** |
| `moveto(newurl='…',flags=1)`, encoded target | **200, target saved with `50%25`** |
| `copyto(strnewurl='…',boverwrite=true)`, encoded target | **200, target saved with `50%25`** |
| `folders/AddUsingPath(DecodedUrl='…')`, apostrophes doubled but not URL-encoded | 404 |
| every `…UsingPath` call below, path through `encodeURIComponent` | 200, exact name |

## Cause

Microsoft documents it: the string-based APIs "handle both encoded and decoded URLs by automatically assuming that % and # characters in a path imply that the URL has been encoded". A name that really contains those characters is therefore misread, and a write stores its own reading of it. The fix Microsoft added is the **ResourcePath** family, which "assumes and only works with decoded URLs" ([Supporting % and # in files and folders with the ResourcePath API](https://learn.microsoft.com/en-us/sharepoint/dev/solution-guidance/supporting-and-in-file-and-folder-with-the-resourcepath-api)).

"Decoded" describes the value, not the transport. The value still travels inside a URL, where `#` starts the fragment (the browser never sends it) and `%` starts an escape sequence. The REST samples in that article put the decoded path into the URL raw — fine for spaces, broken for exactly the two characters the API exists for.

## Fix

Double the apostrophes (OData literal), then URL-encode, and pass the result to the ResourcePath API:

```ts
/** OData string literal for a URL, quotes included: double apostrophes first, then encode. */
const pathLiteral = (p: string): string => "'" + encodeURIComponent(p.split("'").join("''")) + "'";

const fileApi   = (web: string, fileUrl: string) =>
  `${web}/_api/web/GetFileByServerRelativePath(decodedurl=${pathLiteral(fileUrl)})`;
const folderApi = (web: string, folderUrl: string) =>
  `${web}/_api/web/GetFolderByServerRelativePath(decodedurl=${pathLiteral(folderUrl)})`;
```

```text
// read
GET  fileApi(web, url) + '/$value'
GET  folderApi(web, url) + '?$select=Exists'
// write (file name = leaf, folder = server-relative path)
POST folderApi(web, folder) + `/Files/AddUsingPath(DecodedUrl=${pathLiteral(name)},Overwrite=true)`
POST `${web}/_api/web/folders/AddUsingPath(DecodedUrl=${pathLiteral(folderUrl)},Overwrite=true)`
POST folderApi(web, parent) + `/AddSubFolderUsingPath(DecodedUrl=${pathLiteral(leaf)})`
// move / copy (target = server-relative path)
POST fileApi(web, src)   + `/MoveToUsingPath(DecodedUrl=${pathLiteral(dst)},moveOperations=1)`
POST folderApi(web, src) + `/MoveToUsingPath(DecodedUrl=${pathLiteral(dst)})`
POST fileApi(web, src)   + `/CopyToUsingPath(DecodedUrl=${pathLiteral(dst)},bOverWrite=true)`
```

`SP.MoveCopyUtil.MoveFileByPath(overwrite=@a1)?@a1=false` with a JSON body `{ srcPath: { DecodedUrl: <absolute URL> }, destPath: { DecodedUrl: … }, options: { … } }` handled the same names correctly too.

**Migrating changes behaviour on an existing target** (measured the same evening):

| Situation | Old API | ResourcePath API |
|---|---|---|
| Create a folder that already exists | `folders/add` → 200 | `folders/AddUsingPath` (no `Overwrite` or `Overwrite=false`) → **400** "A file or folder with the name … already exists"; `AddSubFolderUsingPath` → **500** with the same text; `folders/AddUsingPath(…,Overwrite=true)` → 200 and the files inside stay |
| Upload over an existing file without overwrite | 400 "A file with the name … already exists" | the same 400 and text |
| Move or copy | empty body | 200 with `{"odata.null": true}` — no file object to read; an existing target without overwrite is a 400 "already exists" (folder: `Cannot rename "y" to "w": destination already exists.`) |
| Missing file / missing folder | 404 / 200 `Exists: false` | 404 "does not exist" / 200 `Exists: false` — unchanged |

So an idempotent "ensure this folder exists" becomes `folders/AddUsingPath(…,Overwrite=true)`; elsewhere treat "already exists" as "it's there". `?$expand=ListItemAllFields&$select=Name,ServerRelativeUrl,UniqueId,ListItemAllFields/Id` works on the `AddUsingPath` response.

## Notes

- **The check and the write must use the same API.** A legacy existence check reports `Exists: false` for a folder whose name has `#` or `%`, and the code that "creates it because it is missing" then makes a `%25` twin.
- A special character in **any** segment breaks the path — a plain file inside `Invoices #2024` is unreachable through the old calls.
- Microsoft lists `web/GetFileByUrl(@u)` with an absolute, properly encoded URL as unambiguous; we did not measure it here.
- Existence checks keep their other trap on both APIs: a missing folder is a 200 with `Exists: false` — [`getfolderbyserverrelativeurl` 200s for a missing folder](getfolderbyserverrelativeurl-200-for-a-missing-folder.md). Move and copy return no usable body — [`moveto` succeeds and your code reports a failure](action-endpoints-return-an-empty-body.md).
- The same two-layer escaping applies to `$filter` values — [An unencoded `#` in a `$filter` value cuts the URL](unencoded-hash-in-a-filter-value-cuts-the-url.md) — and apostrophes are the OData half of it: [Apostrophes in OData literals](odata-string-literals-and-apostrophes.md).
- Review check: search for `ServerRelativeUrl(`, `/files/add(`, `/folders/add(`, `/moveto(` and `/copyto(` built from anything a user can name. Test data rarely contains `#` or `%`; real document names do.
