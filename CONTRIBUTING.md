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
summary: One line for the indexes — the trap and the way out, in a sentence or two
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

The frontmatter feeds the indexes, so two fields matter beyond the obvious ones:

- **`summary`** — one line of Markdown, shown as-is in [INDEX.md](INDEX.md) and in the section README's table. No links (the two indexes sit in different folders, so a relative link would break in one of them).
- **`short-title`** *(optional)* — a shorter link text for the indexes when `title` is long.

The frontmatter must be valid YAML — GitHub renders it as a table and shows an error instead when it is not. Wrap a value in double quotes when it starts with a backtick, a quote or another YAML indicator, or contains `: ` or ` #` (inside the quotes, write `\"` for a quote and `\\` for a backslash); the consistency check below names every value that needs it.

### Scripts (`scripts/`)

- PowerShell, named `Verb-Noun.ps1` (approved verbs), placed in a category subfolder.
- Must carry comment-based help (`.SYNOPSIS`, `.DESCRIPTION`, `.PARAMETER`, `.EXAMPLE`, `.NOTES`) and a `#Requires` statement.
- **ASCII only.** Windows PowerShell 5.1 reads a `.ps1` without a BOM as ANSI, and a typographic dash or quote then ends a string in the middle and breaks the parser. The same goes for PowerShell samples in articles, which people paste into scripts: plain `-` and `"`.
- **Read-only by default.** Anything that changes data must support `-WhatIf` and say so loudly in its header.
- **Prefer the official SharePoint Online Management Shell** (`Microsoft.Online.SharePoint.PowerShell`). Use PnP.PowerShell only where the official module doesn't reach (list-level and content-level work) — say so in the script header, and parameterize the Entra app registration with `-ClientId`, never hardcode it.

### Guides (`guides/`) and snippets (`snippets/`)

`kebab-case.md` with the same frontmatter as gotchas. Guides are task-oriented — they take the reader from A to B, not through the whole alphabet. Snippets are single copy-paste blocks with a two-line intro saying when to reach for them.

## Pull requests

1. One topic per PR.
2. When you add or change an article, regenerate the indexes from the frontmatter:

   ```bash
   node tools/build-index.mjs
   ```

   It rewrites the entries under `gotchas/`, `guides/`, `course/` and `snippets/` in [INDEX.md](INDEX.md) and the `## Index` part of the gotchas, guides and snippets READMEs — don't edit those by hand. A new article lands at the end of its category; to place it elsewhere, move its line in INDEX.md and run the generator again. Scripts and talks are still listed by hand — a new script goes into [scripts/README.md](scripts/README.md) and INDEX.md — and so is the chapter table in the course README.
3. Walk through the sanitization table above one more time.
4. Run the consistency check — it catches indexes that no longer match the frontmatter, a README or sidebar that misses a file, dead relative links, and counts written into prose that nobody updates afterwards:

   ```bash
   node tools/check-vault.mjs
   ```

   It exits non-zero when something is off and names the file. If it reports a count in a sentence, prefer deleting the number over correcting it: prose that says "20 scripts" is wrong again the next time somebody adds one. It also warns — without failing — when an article's text changed more than 30 days after its `last-reviewed` date: review it and move the date.

Not sure whether something fits? [Open an issue](https://github.com/EasyPortal365/sharepoint-vault/issues) and ask.
