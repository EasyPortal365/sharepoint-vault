---
title: A Contribute member can open a protected library to the whole company with a sharing link — set MembersCanShare to false before the first file
short-title: Contribute sharing link bypasses broken inheritance
summary: With the default site setting, a member who only has Contribute on a library with unique permissions can create an "anyone in the organization" link (`ShareLink`, linkKind 2); readers without access then read the file, and the item gets unique permissions so even the direct URL works — `MembersCanShare = false` on the web blocks it (403), and resetting the item's inheritance kills the existing link
tags: [permissions, sharing, libraries, broken-inheritance, hardening]
applies-to: SharePoint Online — any app that promises "drafts are visible only to these groups" on a library with unique permissions
last-reviewed: 2026-11-20
---

# A Contribute member can open a protected library to the whole company with a sharing link — set MembersCanShare to false before the first file

> **Bottom line.** Breaking inheritance on a library protects it from people outside its groups, but not from its own members sharing it. With the default `MembersCanShare = true`, an author who has only **Contribute** created an "anyone in the organization" link on a protected draft (`ListItemAllFields/ShareLink`, `linkKind: 2`, HTTP 200). A reader with no access opened the link and read the file. The item got unique permissions (`SharingLinks.<guid>.OrganizationView: Read` plus Limited Access), so afterwards the reader opened the **direct URL** too. `MERGE /_api/web {MembersCanShare: false}` stops new links (403); `resetroleinheritance` on the item kills the existing one. We did both in one step, so whether an old link survives the setting alone is not measured — assume it does, because the item keeps its own permissions. Set it before the first document lands.
>
> **Ve zkratce.** Zrušené dědění chrání knihovnu před lidmi mimo její skupiny, ale ne před sdílením jejích vlastních členů. S výchozím `MembersCanShare = true` autor jen s **Přispívat** vytvořil k chráněnému konceptu odkaz „kdokoli ve firmě“ (`ListItemAllFields/ShareLink`, `linkKind: 2`, HTTP 200). Čtenář bez přístupu odkaz otevřel a soubor přečetl. Položka tím dostala unikátní oprávnění (`SharingLinks.<guid>.OrganizationView: Read` a Limited Access), takže pak čtenář otevřel i **přímou adresu**. `MERGE /_api/web {MembersCanShare: false}` nové odkazy zastaví (403), `resetroleinheritance` na položce zruší ten existující. Obojí jsme udělali v jednom kroku, takže zda starý odkaz přežije samotné nastavení, změřené není – počítej s tím, že ano, protože položce zůstanou vlastní oprávnění. Nastav to dřív, než přijde první dokument.

## Measured (SharePoint Online, 2026-11-20, ordinary non-admin accounts)

| Step | Result |
|---|---|
| Reader opens the draft by direct URL (library has unique permissions, reader not in it) | access denied |
| Author (Contribute on the library) `POST …/ListItemAllFields/ShareLink` `{request:{createLink:true,settings:{linkKind:2}}}` | **200**, link returned |
| Reader opens the link | file content returned |
| Reader opens the direct URL again | **file content returned** — the item now has its own permissions |
| Admin: `MERGE /_api/web {MembersCanShare:false}` (204) and `…/ListItemAllFields/resetroleinheritance` in the same step | `HasUniqueRoleAssignments` false |
| Author creates the link again | **403** UnauthorizedAccessException |
| Reader opens the old link / the direct URL | error page / access denied |

## Gotchas

- **`linkKind: 6` (flexible link) without `settings.role` returns 400** "Role cannot be empty for Flexible Links". That is a missing parameter, not protection — don't count it as a passed test.
- **Owners can still share.** `MembersCanShare = false` covers members only; say so in the text for the customer and keep the owners' circle small.
- **Hunt for leftovers.** On a site that ran with the default for a while, list items with `HasUniqueRoleAssignments = true` in the protected libraries and reset them after review.
- **Re-read after writing.** Some web settings return 200 without effect; `MembersCanShare` persisted when re-read.

## Related

- [Locking down a NoScript site from code](../security/locking-down-a-noscript-site-from-code.md)
- [Reset inheritance is a one-way door](reset-inheritance-is-a-one-way-door.md)
- [An add-only permission level saves, then reports 403](add-only-permission-level-saves-then-reports-403.md)
