# 🧰 Scripts

PowerShell scripts for SharePoint Online administration and diagnostics.

## Ground rules

- Every script carries comment-based help — run `Get-Help .\TheScript.ps1 -Full` before first use.
- **Read-only unless clearly stated otherwise** in the script header.
- Built on [PnP.PowerShell](https://pnp.github.io/powershell/) and expecting **your own Entra app registration** passed via `-ClientId` ([why and how](https://pnp.github.io/powershell/articles/registerapplication.html)).
- Review the code before running anything against a production tenant. Always.

## Index

### reporting/

| Script | Purpose |
|---|---|
| [Get-SiteCollectionInventory.ps1](reporting/Get-SiteCollectionInventory.ps1) | One CSV with every site collection — storage, owner, template, sharing, lock state, last activity |

### lists-and-libraries/

| Script | Purpose |
|---|---|
| [Get-LargeListsReport.ps1](lists-and-libraries/Get-LargeListsReport.ps1) | Finds lists approaching or past the 5,000-item list view threshold |

## Planned categories

`permissions/` (unique permissions reports, external sharing audits) · `provisioning/` (site and list scaffolding) · `cleanup/` (version trimming reports, orphaned users, abandoned sites)
