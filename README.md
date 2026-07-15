<div align="center">

# 🗝️ SharePoint Vault

*„Zápisky z bojového pole" — Notes from the battlefield.*

**Field-tested scripts, hard-won lessons, and ready-to-use templates for SharePoint professionals.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![PnP.PowerShell](https://img.shields.io/badge/PowerShell-PnP.PowerShell-5391FE?logo=powershell&logoColor=white)](https://pnp.github.io/powershell/)
[![Maintained by EasyPortal 365](https://img.shields.io/badge/maintained%20by-EasyPortal%20365-00CED7)](https://www.easyportal365.com)

</div>

---

## Straight from the battlefield

**SharePoint Vault** is a growing library of practical material for people who build on, administer, and troubleshoot SharePoint — Online first, on-premises where noted.

It is **not** another copy of Microsoft's documentation. Everything in the vault comes from real projects and real tenants: scripts we actually run, traps we actually fell into, and patterns that survived contact with production.

- 🧰 **Scripts** — PowerShell you can run today, with proper help and safe defaults
- 💥 **Gotchas** — short *symptom → cause → fix* write-ups of the traps that cost us hours, so they cost you minutes
- 🧭 **Guides** — end-to-end walkthroughs that connect the dots (REST, Microsoft Graph, SPFx, search)
- ✂️ **Snippets** — copy-paste fragments: REST calls, CAML, list formatting JSON
- 📦 **Templates** — reusable artifacts: site scripts, formatting templates, schema definitions
- 🔗 **Resources** — a curated shortlist of the tools and sources we actually use

## Vault map

| Section | What you'll find |
|---|---|
| [`scripts/`](scripts/) | PowerShell scripts — reporting, lists & libraries, permissions, provisioning |
| [`gotchas/`](gotchas/) | Real-world traps, documented as *symptom → cause → fix* |
| [`guides/`](guides/) | End-to-end guides — REST API, Microsoft Graph, SPFx, search |
| [`snippets/`](snippets/) | Small copy-paste fragments for daily work |
| [`templates/`](templates/) | Reusable templates — site scripts, list formatting, schemas |
| [`resources/`](resources/) | Curated links — tools, docs, community sources |

Prefer everything on a single page? Browse the 🗂️ **[full vault index](INDEX.md)** — a tree of every item in the repo.

## Fresh from the vault

- [**Building a people picker in SPFx — the endpoints that actually work**](gotchas/spfx/people-search-endpoints-that-work.md) — why the obvious ones return nothing, and the SP Search pattern that doesn't
- [**Minified React error #310 (and friends)**](gotchas/spfx/react-minified-errors-cheatsheet.md) — the SPFx debugging cheatsheet for numbers-only errors
- [**Read all items from a large list — paging done right**](snippets/rest/get-all-list-items-paged.md) — `$skip` is a lie on list items; follow `odata.nextLink`
- [**SPO Management Shell one-liners**](snippets/cli/spo-management-shell-one-liners.md) — storage, external sharing, deleted sites, lock state — straight from the official module

## How to use the vault

Browse the folders above, or search within the repo — every article carries frontmatter with `tags` and `applies-to` (SharePoint Online / Server), so a repo search like `path:gotchas threshold` usually gets you straight to the answer.

All scripts in the vault:

- are **read-only unless clearly stated otherwise** in their header,
- carry comment-based help — run `Get-Help .\TheScript.ps1 -Full` before first use,
- prefer the official **SharePoint Online Management Shell** — plain admin sign-in, no app registration needed. [PnP.PowerShell](https://pnp.github.io/powershell/) appears only where the official module can't go (list-level and content-level work); those scripts say so in their header and expect **your own Entra app registration** (`-ClientId`).

> ⚠️ **Always review a script before running it against your tenant.** That's not a disclaimer, that's professional hygiene.

## Contributing

Found a trap we haven't documented? Have a script worth sharing? Issues and PRs are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The golden rule: **sanitize everything** (no real tenant URLs, GUIDs, or account names).

## Who's behind this

The vault is curated by **[Kamil Juřík](https://www.linkedin.com/in/kamiljurik/)** — former Microsoft MVP for SharePoint and Microsoft-certified expert, working hands-on with SharePoint since 2001 across dozens of projects, from small intranets to full-blown business platforms. Czech readers may remember his *„Zápisky z bojového pole"* (Notes from the battlefield) — this vault carries that tradition on, in the open.

It is maintained by the team behind [**EasyPortal 365**](https://www.easyportal365.com) ([LinkedIn](https://www.linkedin.com/company/easyportal-365)) — a suite of business apps built natively on SharePoint Online. The material here comes straight from our day-to-day product development and consulting work.

## License

[MIT](LICENSE) — use it, fork it, ship it. Attribution appreciated, not required.
