# Contributing to SharePoint Vault

Great material comes from real projects — if you have some, we want it. Issues and PRs welcome.

## What belongs here

- **Field-tested** content: things you actually ran, hit, or shipped. No theory-crafting, no rewrites of Microsoft docs.
- **English**, so the whole community can use it.
- Scoped to SharePoint (Online first) and its immediate neighbours: Microsoft Graph, SPFx, PnP tooling, Teams integration.

## The golden rule: sanitize everything

This is a public repository. Before committing, replace:

| Real thing | Replace with |
|---|---|
| Tenant/site URLs | `https://contoso.sharepoint.com/sites/projects` |
| GUIDs from real environments | `00000000-0000-0000-0000-000000000000` or a freshly generated GUID |
| User/customer names and emails | `megan@contoso.com`, "Contoso" |
| Secrets, tokens, connection strings | never — not even expired ones |
| Screenshots with real data | crop, blur, or re-shoot on a demo tenant |

## Formats

### Every article opens with a bilingual bottom line

Guides, gotchas, and course chapters start with a **bottom-line-up-front** statement immediately after the H1 — the single most important takeaway, stated before any detail — in **English and Czech**:

````markdown
# Title

> **Bottom line.** The one thing to remember, in a sentence or two.
>
> **Ve zkratce.** Totéž česky.
````

Keep it to the *takeaway*, not a summary of the whole article. English may use the em-dash "—"; **Czech must use the en-dash "–"** with spaces around it, never the em-dash. (Section READMEs and PowerShell scripts, which already carry comment-based help, are exempt.)

### Gotchas (`gotchas/`)

One trap per file, named `kebab-case.md`, placed in a category subfolder. Use this skeleton:

````markdown
---
title: Short, symptom-first title
tags: [rest-api, lists]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
---

# Title

## Symptom
What you see — error messages verbatim.

## Cause
Why it happens. Keep it short.

## Fix
The working solution, with code.

## Notes
Edge cases, related traps, links.
````

### Scripts (`scripts/`)

- PowerShell, named `Verb-Noun.ps1` (approved verbs), placed in a category subfolder.
- Must carry comment-based help (`.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.NOTES`) and a `#Requires` statement.
- **Read-only by default.** Anything that changes data must support `-WhatIf` and say so loudly in its header.
- **Prefer the official SharePoint Online Management Shell** (`Microsoft.Online.SharePoint.PowerShell`). Use PnP.PowerShell only where the official module doesn't reach (list-level and content-level work) — say so in the script header, and parameterize the Entra app registration with `-ClientId`, never hardcode it.

### Guides (`guides/`) and snippets (`snippets/`)

`kebab-case.md` with the same frontmatter as gotchas. Guides are task-oriented — they take the reader from A to B, not through the whole alphabet. Snippets are single copy-paste blocks with a two-line intro saying when to reach for them.

## Pull requests

1. One topic per PR.
2. When you add a file, update the section README's index **and** the root [INDEX.md](INDEX.md).
3. Walk through the sanitization table above one more time.

Not sure whether something fits? [Open an issue](https://github.com/EasyPortal365/sharepoint-vault/issues) and ask.
