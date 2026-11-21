---
title: An "add only" permission level (Add Items without View Items) saves the file — and then answers 403 or 500
short-title: Add-only permission level saves, then reports 403
summary: A custom permission level with Add Items and Open but no View Items can be created through REST (not in the UI) and gives a write-only library or list; the upload succeeds but `Files/add` returns 403 and `POST /items` returns 500 "Item does not exist", because the server can't return what the caller may not read — use `AddValidateUpdateItemUsingPath` for lists, treat library uploads as unconfirmed, and never measure a direct URL by its status code
tags: [permissions, libraries, lists, permission-levels, append-only, testing]
applies-to: SharePoint Online — write-only archives, drop boxes and append-only logs built with custom permission levels
last-reviewed: 2026-11-21
---

# An "add only" permission level (Add Items without View Items) saves the file — and then answers 403 or 500

> **Bottom line.** You can build a write-only library or list with a custom permission level that has **Add Items** and **Open** but no **View Items** (`Low = 0x10002`, `High = 0x30`). The browser UI won't let you tick Add without View, but `POST /_api/web/roledefinitions` stores it as given. The write then **succeeds**, yet the answer lies: `Files/add` returns **403** and `POST /items` returns **500 "Item does not exist"**, because the server saves first and then fails to return metadata the caller may not read. For lists, `AddValidateUpdateItemUsingPath` returns a clean 200. For libraries, treat the upload as unconfirmed and let a role that can read verify it. Overwriting an existing file and `MoveCopyUtil.CopyFileByPath` do fail for real (403, content unchanged).
>
> **Ve zkratce.** Knihovnu nebo seznam „jen pro vhazování“ postavíš vlastní úrovní oprávnění s **Add Items** a **Open** bez **View Items** (`Low = 0x10002`, `High = 0x30`). V prohlížeči Add bez View naklikat nejde, `POST /_api/web/roledefinitions` ji ale uloží beze změny. Zápis pak **projde**, jenže odpověď lže: `Files/add` vrátí **403** a `POST /items` **500 „Item does not exist“** – server uloží a pak nemůže vrátit metadata, která volající nesmí číst. U seznamů `AddValidateUpdateItemUsingPath` vrátí čisté 200. U knihoven ber nahrání jako neověřené a nech ho ověřit roli, která čte. Přepis existujícího souboru a `MoveCopyUtil.CopyFileByPath` selžou doopravdy (403, obsah beze změny).

## The situation

An archive of superseded documents must be immutable and readable only by quality staff. Authors must still be able to drop the old version in when they publish a new one. Contribute would let them read and delete; Read wouldn't let them write. A document library has no item-level read security, so `ReadSecurity = 2` is not an option either.

## Measured (SharePoint Online, 2026-11-20, ordinary non-admin account)

| Attempt with the add-only level | Response | What actually happened (checked as admin) |
|---|---|---|
| `Files/add(url='…',overwrite=false)` new file | **403** Access denied (also with `Prefer: return=minimal`) | file **exists**, Author = the caller |
| `POST /items` to a list | **500** "Item does not exist" | item **exists** |
| `AddValidateUpdateItemUsingPath` to a list | **200** | item exists |
| `Files/add(…,overwrite=true)` on an existing file | **403** | content unchanged |
| `SP.MoveCopyUtil.CopyFileByPath` into the library | **403** | nothing copied |
| List the library, open a file by direct URL | nothing listed; access denied | — |

With **View Items + Add Items + Open Items + View Versions** (no Edit, no Delete) you get an append-only log that the caller can read: update, delete and `recycle()` of their own item all return 403.

## Gotchas

- **The error code does not mean "not written".** Retrying a 403 upload creates a second file. Keep a backup copy until a role that can read confirms the file is there, then remove the backup.
- **A direct URL without access returns HTTP 200.** `fetch` follows the redirect to `/_layouts/15/AccessDenied.aspx`. Check `new URL(response.url).pathname` or use `redirect: 'manual'` (`opaqueredirect`); a status-code test passes even when access is denied.
- **`ReadSecurity = 2` also hides other people's items from a reviewer** who has only "add and read". Adding **Override List Behaviors** (`0x100`) lets the reviewer see all items without Manage Lists; such a role still can't change list settings or edit someone else's item (403).
- **Role names with parentheses or commas** were rejected by REST (400). Use letters and spaces.
- **Existence checks lie too.** `GetFolderByServerRelativePath` on a folder the caller created earlier returns 200 with `Exists: false`, and `GetFileByServerRelativePath` returns 404. A second file for the same folder therefore tries to create the folder again and gets **400 `-2130575257` "A file or folder with the name … already exists"**. For an add-only role, treat that error code (not the message text, which follows the site language) as success; any other 400 is still an error.

## Related

- [A drop box for sensitive files — a list with ReadSecurity 2 and attachments](upload-only-drop-box-for-sensitive-photos.md)
- [Editing others' items needs Override List Behaviors](editing-others-items-needs-override-list-behaviors.md)
- [A Contribute member can open a protected library with a sharing link](contribute-sharing-link-bypasses-broken-inheritance.md)
