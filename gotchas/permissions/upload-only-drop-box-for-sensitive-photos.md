---
title: A drop box for sensitive files — a document library can't do it, a list with ReadSecurity 2 and attachments can (measured, including the direct attachment URL)
short-title: Upload-only drop box for sensitive files
summary: Giving someone write access to a protected library folder also lets them read every file in it; a list with `ReadSecurity = 2`, Contribute for the senders and Edit for the reviewers lets people send files they alone can see — the direct attachment URL of someone else's item is denied in SharePoint Online (measured)
tags: [permissions, lists, attachments, item-level-security, libraries, sensitive-data]
applies-to: SharePoint Online — any "people send files that only a small team may see" feature (injury photos, incident evidence, HR documents)
last-reviewed: 2026-10-01
---

# A drop box for sensitive files — a document library can't do it, a list with ReadSecurity 2 and attachments can

> **Bottom line.** A document library has no item-level read security. Giving someone write access to a protected library folder lets them read every file in it, so a library can't act as a drop box where people send files they can't then read. A **list** with `ReadSecurity = 2` can. Give the senders **Contribute** (no Manage Lists, so item-level security applies to them) and the reviewers **Edit** (Manage Lists bypasses it). Senders store files as **attachments** of their own items. We measured in SharePoint Online that a sender can't reach another sender's attachment by any route, including its direct URL. Reviewers then move the files into the protected library folder and delete the list item.
>
> **Ve zkratce.** Knihovna dokumentů nemá item-level čtení: právo zapisovat do chráněné složky je zároveň právo číst všechny soubory v ní. Jako „schránka, do které jde jen vhazovat“ proto knihovna nefunguje. Seznam s `ReadSecurity = 2` ano. Odesílatelé mají **Přispívat** (bez Spravovat seznamy, takže item-level na ně platí), posuzovatelé **Úpravy** (Spravovat seznamy ho obchází). Soubory odesílatelé ukládají jako **přílohy** svých položek. Změřeno v SharePoint Online: k příloze cizí položky se odesílatel nedostane žádnou cestou, ani přímou adresou. Posuzovatel pak soubory přesune do chráněné složky knihovny a položku smaže.

## The situation

Shift supervisors photograph workplace injuries on their phones. A photo of an injury is health data: only the safety officer and HR may see it. Those two roles have a library folder with unique permissions.

The obvious move is to let supervisors upload into that folder, and it fails. A library does not support item-level read security ("read only items the user created"). The UI does not offer it, and files inherit the folder's ACL. If supervisors can write to the folder, they can also open every injury photo of every other case.

## The pattern

| Object | Senders (supervisors) | Reviewers (safety, HR) |
|---|---|---|
| Inbox **list**, `ReadSecurity = 2`, `WriteSecurity = 2`, unique permissions | **Contribute**: they add items, attach files and see only their own items | **Edit**: Manage Lists bypasses item-level security, so they see and delete every item |
| Protected library folder | nothing | Edit |

1. The sender creates one inbox item, carrying the case id, then adds the photos with `items(<id>)/AttachmentFiles/add(FileName='…')`. The body is the raw bytes with `Content-Type: application/octet-stream`.
2. When a reviewer opens the case, the app reads `items?$filter=CaseId eq N&$expand=AttachmentFiles`. It downloads each file with `GetFileByServerRelativePath(decodedurl='…')/$value` and uploads it into the protected folder.
3. Delete the inbox item **only after every file has uploaded**. If anything fails, the item stays and the next case open retries. If file names are deterministic, a retry becomes a new version of the same file, not a duplicate.

Remove the default site groups (Members, Visitors) from the inbox entirely. Otherwise a site member with Edit has Manage Lists and reads everything.

## Measured (SharePoint Online, 2026-10-01)

Test setup: a reviewer account (site collection admin) created an item with an attachment. A sender account, which belongs only to the Contribute group, then tried to reach it:

| Attempt by the sender | Result |
|---|---|
| Direct URL `/Lists/<inbox>/Attachments/<id>/<file>.jpg` | Access denied page ("you need access") |
| `GetList('…')/items?$select=Id,Title` | HTTP 200, **empty** feed: the foreign item is not listed |
| `GetList('…')/items(<id>)/AttachmentFiles` | `System.ArgumentException`: "Item does not exist" |

The attachment inherits the item's item-level protection, including its direct URL. A Microsoft Q&A answer says the same and adds that on-premises SharePoint 2016 behaved differently, because attachments there sat in a separately secured folder. Measure on your own tenant before you rely on it outside SharePoint Online.

## Gotchas

- **The access-denied page says "you don't have access to this list".** That wording does not mean the sender lost the whole list. Check with the `items` query: an empty 200 means the list is readable and only the foreign item is hidden.
- **Don't give senders Edit "to be safe".** Edit includes Manage Lists, which silently turns `ReadSecurity = 2` off for them. Assert the absence of Manage Lists on the sender group in your hardening checks.
- **An empty inbox item looks like "photos waiting".** If none of the attachments uploaded, delete the item right away.
- **Resize photos on the phone before sending.** Phone photos are 3–8 MB and shop floors have weak signal. Redrawing on a canvas also strips EXIF, including GPS. HEIC that the browser can't decode has to go up as the original, still carrying its EXIF.

## Related

- [A count over a ReadSecurity 2 list is only the reader's share](a-count-over-a-readsecurity-2-list-is-the-readers-share.md)
- [WriteSecurity 4 needs Manage Lists](write-security-4-needs-managelists.md)
- [Upload a generated image as a list item attachment](../../snippets/rest/upload-generated-image-as-list-attachment.md)
