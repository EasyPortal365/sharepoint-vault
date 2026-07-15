# 🗂️ Vault Index

Every single thing in the vault, on one page. Section names link to folder READMEs; leaves link straight to the content.

*Last updated: 2026-07-15*

- 🧰 **[scripts/](scripts/)** — PowerShell scripts with comment-based help, read-only unless stated
  - **reporting/**
    - [Get-SiteCollectionInventory.ps1](scripts/reporting/Get-SiteCollectionInventory.ps1) — every site collection in one CSV: storage, owner, template, sharing, lock state, last activity
  - **lists-and-libraries/**
    - [Get-LargeListsReport.ps1](scripts/lists-and-libraries/Get-LargeListsReport.ps1) — lists approaching or past the 5,000-item view threshold
- 💥 **[gotchas/](gotchas/)** — real-world traps as *symptom → cause → fix*
  - **rest-api/**
    - [Get lists by URL, not by title](gotchas/rest-api/get-list-by-url-not-by-title.md) — `getbytitle()` breaks the moment someone renames a list; resolve by URL
    - [Search REST needs `odata-version: 3.0`](gotchas/rest-api/search-api-needs-odata-version-3.md) — the header behind mysterious search 500s
  - **lists/**
    - [The 5,000-item view threshold](gotchas/lists/list-view-threshold-and-indexes.md) — it's scanned rows, not returned rows; index early, page always
  - **spfx/**
    - [The ES2015 `lib` trap](gotchas/spfx/es2015-lib-forbidden-apis.md) — TS2550 on `padStart` & friends, and the safe equivalents
- 🧭 **[guides/](guides/)** — end-to-end walkthroughs
  - *first guides in the works — see [planned topics](guides/README.md)*
- ✂️ **[snippets/](snippets/)** — small copy-paste fragments
  - *coming soon — see [planned categories](snippets/README.md)*
- 📦 **[templates/](templates/)** — reusable artifacts to adapt, not rewrite
  - *coming soon — see [planned categories](templates/README.md)*
- 🔗 **[resources/](resources/)** — a deliberately short list of sources we actually use
  - [Official documentation](resources/README.md#official-documentation) — SharePoint dev docs, Microsoft Graph, admin docs, M365 roadmap
  - [Tooling](resources/README.md#tooling) — PnP.PowerShell, CLI for Microsoft 365, Graph Explorer, SP Editor
  - [Community](resources/README.md#community) — PnP community, sp-dev-docs issues, List Formatting samples, SPFx samples, look book
- 📄 **Repo meta**
  - [README](README.md) — the front page
  - [CONTRIBUTING](CONTRIBUTING.md) — content formats, sanitization rules, PR process
  - [LICENSE](LICENSE) — MIT
