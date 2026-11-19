---
title: Read lets people open every old version of a file, and Contribute lets them delete — two custom levels that close both (measured)
short-title: Read opens old versions, Contribute deletes
summary: The built-in Read level includes View Versions, so a reader opens an overwritten file's earlier content through `versions(<id>)/$value` or `_vti_history`; Read without View Versions blocks both and still opens the current file. Contribute without Delete Items and Delete Versions blocks delete, recycle, move and rename — but still allows overwriting someone else's file
tags: [permissions, permission-levels, versioning, libraries, hardening]
applies-to: SharePoint Online — libraries where a file is overwritten in place, and lists or libraries where members must edit but never delete
last-reviewed: 2026-11-20
---

# Read lets people open every old version of a file, and Contribute lets them delete — two custom levels that close both (measured)

> **Bottom line.** The built-in **Read** level includes **View Versions**. If you overwrite a published file in place (a regenerated PDF, a corrected policy), every reader can still open the earlier content: `GetFileByServerRelativeUrl(…)/versions(512)/$value` and `/_vti_history/512/<library>/<file>` both returned it. A custom level "Read without View Versions" (Read's mask minus `0x40`) blocks both (403 / access denied) and still opens the current file. On the write side, **Contribute** includes Delete. A custom "Contribute without delete" (minus `DeleteListItems 0x8` and `DeleteVersions 0x80`) blocks delete, `recycle()`, `MoveCopyUtil.MoveFileByPath` and `moveto` (rename) with 403 — but overwriting **someone else's** file still succeeds, so the version history is your only undo.
>
> **Ve zkratce.** Standardní úroveň **Číst** obsahuje **View Versions**. Když publikovaný soubor přepíšeš na místě (přegenerované PDF, opravená směrnice), každý čtenář otevře i předchozí obsah: `GetFileByServerRelativeUrl(…)/versions(512)/$value` i `/_vti_history/512/<knihovna>/<soubor>` ho vrátily. Vlastní úroveň „Číst bez historie verzí“ (maska Číst bez `0x40`) obojí zablokuje (403 / přístup odepřen) a aktuální soubor otevře. Na straně zápisu **Přispívat** obsahuje mazání. Vlastní „Přispívat bez mazání“ (bez `DeleteListItems 0x8` a `DeleteVersions 0x80`) zablokuje smazání, `recycle()`, `MoveCopyUtil.MoveFileByPath` i `moveto` (přejmenování) s 403 – přepis **cizího** souboru ale projde, takže jedinou cestou zpět je historie verzí.

## Measured (SharePoint Online, 2026-11-20, ordinary non-admin account)

| Level | Attempt | Result |
|---|---|---|
| Read | open current file / old version via `versions(512)/$value` / via `_vti_history/512/…` | current ✓ / **old content returned** / **old content returned** |
| Read without View Versions | the same three | current ✓ / 403 / redirect to `AccessDenied.aspx` (HTTP 200 — check the final URL) |
| Contribute without delete | upload, upload again, `ValidateUpdateListItem` on own file | 200 |
| Contribute without delete | delete or `recycle()` own or foreign file; `MoveFileByPath`; `moveto(newurl=…,flags=1)` | 403, files unchanged |
| Contribute without delete | `PUT …/$value` on a file someone else uploaded | **204** — content replaced |

Create the levels through `POST /_api/web/roledefinitions` with `BasePermissions` computed from `getbytype(2)` / `getbytype(3)` (`Low & ~mask`), not hard-coded, and keep the names to letters and spaces.

## Gotchas

- **No rename means names are final.** With delete removed, a user can't rename a file either — `moveto` needs Delete on the source. Put changing values (document number, status) in metadata, not in the file name.
- **Discarding without delete:** mark the file (a metadata flag) and let a role that has delete clean it up later.
- **An app that must remove a file immediately** (unpublish the old version so readers never see it) needs Delete for whoever triggers it. Detect deletions that bypass the app instead of pretending they can't happen.

## Related

- [An add-only permission level saves, then reports 403](add-only-permission-level-saves-then-reports-403.md)
- [File versions are oldest first](../rest-api/file-versions-are-oldest-first.md)
- [Editing others' items needs Override List Behaviors](editing-others-items-needs-override-list-behaviors.md)
