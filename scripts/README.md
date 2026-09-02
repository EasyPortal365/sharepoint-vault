# 🧰 Scripts

PowerShell scripts for SharePoint Online administration and diagnostics.

## Ground rules

- Every script carries comment-based help — run `Get-Help .\TheScript.ps1 -Full` before first use.
- **Read-only unless clearly stated otherwise** in the script header. Four scripts write, each supports `-WhatIf`, and each says so loudly in its first line: [Remove-ExcessFileVersions.ps1](cleanup/Remove-ExcessFileVersions.ps1), [Set-SiteSharingCapability.ps1](permissions/Set-SiteSharingCapability.ps1), [Set-SiteDefaultLinkPermission.ps1](permissions/Set-SiteDefaultLinkPermission.ps1), [Set-SiteAccessRequestSettings.ps1](permissions/Set-SiteAccessRequestSettings.ps1). Every `Set-` script writes a backup CSV of the previous state — even under `-WhatIf` — before touching anything.
- **Module policy:** scripts use the official [SharePoint Online Management Shell](https://learn.microsoft.com/en-us/powershell/sharepoint/sharepoint-online/connect-sharepoint-online) (`Microsoft.Online.SharePoint.PowerShell`) wherever it covers the task — plain admin sign-in, no app registration. [PnP.PowerShell](https://pnp.github.io/powershell/) appears only where the official module can't go (list-level and content-level work); those scripts say so in their header and expect **your own Entra app registration** via `-ClientId` ([why and how](https://pnp.github.io/powershell/articles/registerapplication.html)).
- **Partial results are labelled as partial.** Where a script caps a scan (`-MaxItemsPerList`, `-RowLimit`, `-MaxFilesPerLibrary`) it says so in the output instead of letting a truncated report read as a complete one. Same for failed reads: a library that couldn't be read is reported as *read failed*, never as *nothing found*.
- Review the code before running anything against a production tenant. Always.

🎬 **[Terminal animations](media/)** — the three writing scripts as an animated console, so you can see how a run unfolds before you start one.

📄 **[What the scripts actually print](sample-outputs.md)** — console output and CSV samples for every script, taken from real runs against a live tenant. Includes what they look like when a read is denied, which is the output you most need to recognise.

## Index

### reporting/

| Script | Purpose |
|---|---|
| [Get-SiteCollectionInventory.ps1](reporting/Get-SiteCollectionInventory.ps1) | One CSV with every site collection — storage, owner, template, sharing, lock state, last activity |
| [Get-HubSiteStructure.ps1](reporting/Get-HubSiteStructure.ps1) | The whole hub topology: every hub, its associated sites, and the standalone leftovers |
| [Get-InactiveSitesReport.ps1](reporting/Get-InactiveSitesReport.ps1) | Sites nobody has touched in N days, with the storage they're holding |
| [Get-TenantSettingsBaseline.ps1](reporting/Get-TenantSettingsBaseline.ps1) | Snapshot tenant settings to JSON, then diff a later run to see what changed |
| [Get-AppCatalogInventory.ps1](reporting/Get-AppCatalogInventory.ps1) | SPFx solutions in the catalog vs. the version each site actually runs *(PnP)* |

### permissions/

| Script | Purpose |
|---|---|
| [Get-ExternalSharingReport.ps1](permissions/Get-ExternalSharingReport.ps1) | Sharing capability per site + every guest, with the `Get-SPOExternalUser` paging cap handled |
| [Get-UniquePermissionsReport.ps1](permissions/Get-UniquePermissionsReport.ps1) | Broken inheritance at web, list and (opt-in) item level, with the principals behind it *(PnP)* |
| [Get-SharingLinksReport.ps1](permissions/Get-SharingLinksReport.ps1) | The hidden `SharingLinks.*` groups — who is on which link, and which document it opens *(PnP)* |
| [Get-EveryoneClaimReport.ps1](permissions/Get-EveryoneClaimReport.ps1) | Where "Everyone" / "Everyone except external users" was granted — including buried inside groups *(PnP)* |
| [Get-SiteCollectionAdminReport.ps1](permissions/Get-SiteCollectionAdminReport.ps1) | Who bypasses every permission on every site, and which of them are guests |
| [Set-SiteSharingCapability.ps1](permissions/Set-SiteSharingCapability.ps1) | ⚠️ **Writes.** Turns external sharing on/off per site or tenant-wide; refuses to exceed the tenant ceiling, backs up first |
| [Set-SiteDefaultLinkPermission.ps1](permissions/Set-SiteDefaultLinkPermission.ps1) | ⚠️ **Writes.** Changes the pre-selected sharing permission (Edit → View), so Edit stops being the accident |
| [Set-SiteAccessRequestSettings.ps1](permissions/Set-SiteAccessRequestSettings.ps1) | ⚠️ **Writes.** The whole *Access Requests Settings* dialog: who may share, who may invite, where requests go, custom message *(PnP + CSOM)* |

### lists-and-libraries/

| Script | Purpose |
|---|---|
| [Get-LargeListsReport.ps1](lists-and-libraries/Get-LargeListsReport.ps1) | Finds lists approaching or past the 5,000-item list view threshold *(PnP)* |
| [Get-ListInventory.ps1](lists-and-libraries/Get-ListInventory.ps1) | Every list and library with its versioning policy, content types and unique permissions *(PnP)* |
| [Get-ListIndexAdvice.ps1](lists-and-libraries/Get-ListIndexAdvice.ps1) | Which big lists have no index, and how many of the 20 index slots are left *(PnP)* |
| [Get-CheckedOutFilesReport.ps1](lists-and-libraries/Get-CheckedOutFilesReport.ps1) | Files locked by someone else — including the never-checked-in ones nobody else can see *(PnP)* |
| [Get-ContentTypeUsage.ps1](lists-and-libraries/Get-ContentTypeUsage.ps1) | Where a content type is really used, matched by Id prefix so inherited copies count *(PnP)* |
| [Get-LongFileUrlReport.ps1](lists-and-libraries/Get-LongFileUrlReport.ps1) | Paths and names near the length limits, plus the characters that break sync *(PnP)* |

### cleanup/

| Script | Purpose |
|---|---|
| [Get-FileVersionBloatReport.ps1](cleanup/Get-FileVersionBloatReport.ps1) | How much storage version history really eats, per library and per file *(PnP)* |
| [Remove-ExcessFileVersions.ps1](cleanup/Remove-ExcessFileVersions.ps1) | ⚠️ **Writes.** Trims version history to the newest N per file. `-WhatIf` supported *(PnP)* |
| [Get-RecycleBinReport.ps1](cleanup/Get-RecycleBinReport.ps1) | Both recycle bin stages: what's in them, who deleted it, days until purge *(PnP)* |
| [Get-DeletedSitesReport.ps1](cleanup/Get-DeletedSitesReport.ps1) | Deleted site collections with the 93-day restore countdown |
| [Get-DuplicateFilesReport.ps1](cleanup/Get-DuplicateFilesReport.ps1) | Duplicates by name + byte size via the search index, `TrimDuplicates` off *(PnP)* |

### search/

| Script | Purpose |
|---|---|
| [Test-SearchManagedProperty.ps1](search/Test-SearchManagedProperty.ps1) | Proves a managed property exists, holds data and is filterable — via the `sortlist` probe, with a control sample *(PnP)* |

## Planned categories

`provisioning/` (site and list scaffolding) · `teams/` (Teams-connected site governance) · `migration/` (pre-flight checks)
