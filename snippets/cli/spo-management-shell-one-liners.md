---
title: SPO Management Shell one-liners every admin ends up needing
tags: [powershell, spo-management-shell, admin]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
---

# SPO Management Shell one-liners every admin ends up needing

**When to reach for them:** quick answers from the official module, no app registration, no script file. Prereq:

```powershell
Connect-SPOService -Url https://contoso-admin.sharepoint.com
```

All read-only unless marked **[writes]**.

**Top 20 site collections by storage:**

```powershell
Get-SPOSite -Limit All | Sort-Object StorageUsageCurrent -Descending |
  Select-Object -First 20 Url, StorageUsageCurrent, StorageQuota
```

**Every site where external sharing is on:**

```powershell
Get-SPOSite -Limit All | Where-Object { $_.SharingCapability -ne 'Disabled' } |
  Select-Object Url, SharingCapability
```

**All external users in the tenant (paged):**

```powershell
Get-SPOExternalUser -PageSize 50 | Select-Object DisplayName, Email, WhenCreated
```

**Tenant-level sharing posture at a glance:**

```powershell
Get-SPOTenant | Select-Object SharingCapability, DefaultSharingLinkType
```

**Deleted site collections still restorable (and for how long):**

```powershell
Get-SPODeletedSite | Select-Object Url, DaysRemaining
```

**Restore one of them [writes]:**

```powershell
Restore-SPODeletedSite -Identity https://contoso.sharepoint.com/sites/projects
```

**Freeze a site during migration or investigation [writes]:**

```powershell
Set-SPOSite -Identity https://contoso.sharepoint.com/sites/projects -LockState ReadOnly
# and back: -LockState Unlock
```

**Grant yourself (or a colleague) site collection admin [writes]:**

```powershell
Set-SPOUser -Site https://contoso.sharepoint.com/sites/projects `
  -LoginName megan@contoso.com -IsSiteCollectionAdmin $true
```

Notes:

- `Get-SPOSite -Limit All` returns the tenant-admin view — no site-by-site permissions needed, but also no list/content level detail (that's [where PnP comes in](../../scripts/README.md)).
- OneDrive sites are excluded by default; add `-IncludePersonalSite $true` when you really want them.
- Anything marked **[writes]** deserves a second look before Enter — especially `LockState`, which kicks users out immediately.
