---
title: "Content approval with drafts visible to approvers: `ApproveItems` alone shows no drafts — the approver also needs `EditListItems`"
short-title: "`ApproveItems` alone does not show drafts"
summary: "With content approval and `DraftVersionVisibility = Approver`, a role with Read + ApproveItems sees neither drafts nor pending files and its `Approve` returns 404; Read + EditListItems + ApproveItems works. An Edit member who is not the author sees only the last approved major. MERGE on `roledefinitions(id)` returns 204 but does not change the mask — measured live"
tags: [permissions, rest-api, versioning, content-approval, drafts, role-definitions]
applies-to: SharePoint Online document libraries with minor versions and content approval (`EnableModeration`), REST `Publish` / `Approve`
last-reviewed: 2026-11-25
---

# Content approval with drafts visible to approvers: `ApproveItems` alone shows no drafts — the approver also needs `EditListItems`

> **Bottom line.** In a library with minor versions, content approval and “drafts visible to users who can approve”, a custom role of Read + **Approve Items** sees no drafts and no pending files, so `Approve` returns 404 (“file does not exist”). SharePoint does not add the dependency for you when you create the role over REST. Give approvers **Read + Edit Items + Approve Items** (the built-in Design level carries both bits; Edit has no Approve Items). A member with **Edit** who is not the author sees only the last approved major — so this configuration does hide drafts from editors, unlike “drafts visible to users who can edit”.
>
> **Ve zkratce.** V knihovně s vedlejšími verzemi, schvalováním obsahu a „koncepty vidí ti, kdo smí schvalovat“ vlastní role Čtení + **Schvalovat položky** nevidí koncepty ani čekající soubory a `Approve` vrátí 404. SharePoint závislost při založení role přes REST nedoplní. Schvalovatel potřebuje **Čtení + Upravovat položky + Schvalovat položky** (vestavěná úroveň Návrh má oba bity, Úpravy Schvalovat nemají). Člen s **Úpravami**, který není autor, vidí jen poslední schválenou hlavní verzi – tahle konfigurace tedy koncepty před editory skryje, na rozdíl od „koncepty vidí ti, kdo smí upravovat“.

## Measured (one library, two accounts, A/B per row)

Files: `a.pdf` = approved 1.0 + draft 1.1 by another user; `b.pdf` = draft 0.1 only. The test account reads through `/items`, `/$value` and the direct file URL.

| Library setting | Test account role | What it sees |
|---|---|---|
| Minor versions, drafts visible to **readers** | Read | everything, drafts included |
| Drafts visible to **authors** (users who can edit) | Read | `a.pdf` at 1.0 only; `b.pdf` 404 |
| same | Edit | all drafts |
| + content approval, drafts visible to **approvers** | Edit (not author) | `a.pdf` at 1.0 only; `b.pdf` 404 |
| same | Edit | own upload + `Publish` → status Pending, label stays `0.1`; `Approve` → **403** |
| same | Read + ApproveItems (mask `138612849`) | no drafts, no pending; `Approve` → **404** |
| same | Read + EditListItems + ApproveItems (`138612853`) | drafts and pending visible; `Approve` → 200, `0.1` becomes `1.0` |

Side observations:

- Overwriting an approved file with Edit Items in a moderated library creates a new draft (`1.2`); readers keep getting `1.0` until someone approves it.
- `moveto` into a subfolder keeps the version history, the current draft, the moderation status and `UniqueId`.

## Second trap: updating a role definition's mask

```
POST /_api/web/roledefinitions(<id>)   X-HTTP-Method: MERGE
{ "BasePermissions": { "Low": "...", "High": "176" } }   →  204
```

The response is 204, but `GetUserEffectivePermissions` still shows the old mask. Do not trust the 204: create a new role definition with the mask you need, move the assignments to it, then delete the old one.

## Rule

- When an approver must see drafts, check both bits (`EditListItems` 0x4 and `ApproveItems` 0x10) in `GetUserEffectivePermissions` for each approver principal. An audit that checks only `ApproveItems` reports a working setup that cannot approve.
- “Drafts visible to users who can edit” does **not** hide drafts from members with Edit. Use content approval with “drafts visible to approvers”.
- After changing a role definition, measure the effective permissions instead of trusting the status code.
