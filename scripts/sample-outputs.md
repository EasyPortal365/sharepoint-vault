---
title: What the scripts actually print
tags: [powershell, reporting]
applies-to: SharePoint Online
last-reviewed: 2026-07-29
---

# What the scripts actually print

> **Bottom line.** Every sample below is a real run against a live tenant with the names swapped for Contoso — including the failures, because knowing what a script looks like when it *cannot* read something is worth more than knowing what it looks like when everything works.
>
> **Ve zkratce.** Každá ukázka níže je skutečný běh proti živému tenantu s přejmenováním na Contoso – včetně selhání, protože vědět, jak skript vypadá, když něco přečíst **ne**dokáže, je cennější než vědět, jak vypadá, když všechno klapne.

Console output is trimmed; CSV samples show the header plus a row or two. Numbers are real in shape (110 sites, 26 guests, 236 tenant properties), only identities are replaced.

---

## reporting/

### Get-SiteCollectionInventory.ps1

```text
Connecting to https://contoso-admin.sharepoint.com ...
Retrieving site collections (this can take a while on large tenants) ...

Done. 110 site collections exported to C:\reports\SiteCollectionInventory.csv
Total storage in scope: 117,8 GB
```

```csv
Url,Title,Template,StorageUsedMB,StorageQuotaMB,Owner,SharingCapability,LockState,LastContentModifiedDate
https://contoso.sharepoint.com/sites/marketing,Marketing,GROUP#0,842,26214400,megan@contoso.com,ExternalUserSharingOnly,Unlock,2026-07-28 09:14:22
```

### Get-HubSiteStructure.ps1

```text
Connecting to https://contoso-admin.sharepoint.com ...
3 hub site(s) registered.
Retrieving site collections ...

[hub] Departments  (https://contoso.sharepoint.com/sites/departments)
       |- Finance  (https://contoso.sharepoint.com/sites/finance)
       |- Human Resources  (https://contoso.sharepoint.com/sites/hr)
[hub] Projects  (https://contoso.sharepoint.com/sites/projects-hub)
       |- (no associated sites)

Done. 110 row(s) written to C:\reports\HubSiteStructure.csv
3 hub(s), 24 associated site(s), 83 standalone site(s).
```

A tenant with no hubs stops early and says so, rather than writing an empty CSV:

```text
0 hub site(s) registered.
No hub sites in this tenant - nothing to map.
```

### Get-InactiveSitesReport.ps1

```text
110 site(s) in scope, cutoff 2026-06-29.

Done. 21 inactive site(s) written to C:\reports\InactiveSites.csv
Storage held by inactive sites: 24 MB

Ten longest dormant:

Url                                                DaysInactive StorageUsedMB Owner
---                                                ------------ ------------- -----
https://contoso.sharepoint.com/sites/DaikinQuote              72             1 megan@contoso.com
https://contoso.sharepoint.com/sites/AllCompany.4718543       72             1 megan@contoso.com
```

Note the unit. An earlier version printed `0 GB` here, because 24 MB rounds to zero — and "0 GB" reads as *there is nothing there*, which is a different claim from *there is very little there*.

### Get-TenantSettingsBaseline.ps1

```text
Connecting to https://contoso-admin.sharepoint.com ...
Captured 236 tenant properties.
Baseline written to C:\reports\TenantBaseline.json
```

Second run against the stored baseline:

```text
Comparing against baseline captured 2026-07-29T14:39:12.4180000Z
3 setting(s) changed:

Setting                             Before                   After
-------                             ------                   -----
SharingCapability                   ExternalUserSharingOnly  ExternalUserAndGuestSharing
RequireAnonymousLinksExpireInDays   30                       -1
LegacyAuthProtocolsEnabled          False                    True
```

### Get-AppCatalogInventory.ps1

```text
Reading tenant app catalog https://contoso.sharepoint.com/sites/appcatalog ...
  7 solution(s) in the catalog.
Reading installed apps on https://contoso.sharepoint.com/sites/intranet ...
  Contoso Workplace: installed 1.22.0.0, catalog 1.25.0.0

Done. 12 row(s) written to C:\reports\AppCatalogInventory.csv
1 site installation(s) are behind the catalog version.
```

---

## permissions/

### Get-ExternalSharingReport.ps1

```text
Tenant sharing capability: ExternalUserSharingOnly
Retrieving site collections ...
  110 site(s) written to C:\reports\ExternalSharing.csv
Enumerating external users (50 per page) ...
  26 guests so far ...
  26 external user(s) written to C:\reports\ExternalSharing_Guests.csv

Done.
```

```csv
DisplayName,Email,AcceptedAs,InvitedBy,WhenCreated,UniqueId
Megan Bowen,megan@fabrikam.com,megan@fabrikam.com,adele@contoso.com,2025-11-04 08:22:10,00000000-0000-0000-0000-000000000000
```

### Get-EveryoneClaimReport.ps1

Found something:

```text
Scanning https://contoso.sharepoint.com/sites/hr ...
  2 grant(s) found.

Done. 2 row(s) written to C:\reports\EveryoneClaims.csv
1 of them are the real 'Everyone' claim, which INCLUDES external guests.
```

```csv
SiteUrl,Scope,Object,Claim,GrantedVia,Permission,LoginName
https://contoso.sharepoint.com/sites/hr,List,Salary Review,Everyone (includes guests),Direct role assignment,Read,c:0(.s|true
https://contoso.sharepoint.com/sites/hr,Group membership,HR Members,Everyone except external users,"Member of SharePoint group ""HR Members""",(whatever the group holds),c:0-.f|rolemanager|spo-grid-all-users/00000000-0000-0000-0000-000000000000
```

**And what it prints when it cannot read** — this is the important one, and it is a real run:

```text
Scanning https://contoso.sharepoint.com/sites/intranet ...
WARNING: Failed to scan https://contoso.sharepoint.com/sites/intranet: Attempted to perform an unauthorized operation.

1 site(s) could NOT be scanned - this report does not cover them:
  https://contoso.sharepoint.com/sites/intranet
Reading role assignments needs Full Control. Treat a clean result for these sites as unknown, not safe.

Done, but NOT ONE site could be scanned. This is not a clean result - it is no result.
```

The first version of this script printed `Done. Nothing found.` in exactly that situation. On a security report that sentence ends the audit.

### Get-SharingLinksReport.ps1

```text
Scanning https://contoso.sharepoint.com/sites/projects ...
  4 sharing link group(s) found.

Done. 4 sharing link(s) written to C:\reports\SharingLinks.csv
  3 link(s) are Anonymous or Flexible (specific-people/anyone) - review those first.
```

```csv
SiteUrl,LinkKind,DocumentGuid,DocumentPath,MemberCount,Members,GroupId,GroupLogin
https://contoso.sharepoint.com/sites/projects,Flexible,00000000-0000-0000-0000-000000000000,/sites/projects/Shared Documents/Q4 Budget.xlsx,2,megan@fabrikam.com; alex@fabrikam.com,31,SharingLinks.00000000-0000-0000-0000-000000000000.Flexible.00000000-0000-0000-0000-000000000000
```

### Get-SiteCollectionAdminReport.ps1

```text
Done. 214 row(s) across 110 site(s) written to C:\reports\SiteCollectionAdmins.csv
  2 site collection admin(s) are EXTERNAL accounts.
  9 site(s) have more than 3 administrators.
```

### Get-UniquePermissionsReport.ps1

```text
Scanning https://contoso.sharepoint.com/sites/projects ...
  30 list(s), 2 with unique permissions.
    list: Contracts
    list: Board Documents

Done. 3 row(s) written to C:\reports\UniquePermissions.csv
```

A full `-IncludeItems` pass over 30 lists takes about ten seconds, because the unique-permission flag for every item arrives in one request per list:

```text
  [3/30] Contracts (412 items) ...
  [4/30] Board Documents (18 items) ...
```

```csv
SiteUrl,Scope,Object,ItemCount,Principals,Note
https://contoso.sharepoint.com/sites/projects,List,Contracts,412,Legal Team [Full Control]; Finance Owners [Edit],
https://contoso.sharepoint.com/sites/projects,List,Board Documents,18,Board [Read],PARTIAL SCAN - only the first 2000 items were checked
```

---

### Set-SiteSharingCapability.ps1 — ⚠️ writes

Always start here. The backup is written even under `-WhatIf`:

```text
*** This script CHANGES external sharing settings. Run with -WhatIf first. ***
Connecting to https://contoso-admin.sharepoint.com ...
Tenant ceiling: ExternalUserSharingOnly
1 site(s) in scope.
Backup written to .\SharingCapability_Backup_20260901-101500.csv

What if: Performing the operation "Set sharing to Disabled (was
ExternalUserSharingOnly)" on target "https://contoso.sharepoint.com/sites/projects".

Changed : 0
Skipped : 0 (0 already at target, 0 locked)
FAILED  : 0
```

A real run across the tenant, showing each kind of skip:

```text
110 site(s) in scope.
  changed  https://contoso.sharepoint.com/sites/projects  ExternalUserSharingOnly -> ExistingExternalUserSharingOnly
  skipped  https://contoso.sharepoint.com/sites/archive   already ExistingExternalUserSharingOnly
  SKIPPED  https://contoso.sharepoint.com/sites/legal     site is locked (ReadOnly)

Changed : 96
Skipped : 13 (11 already at target, 2 locked)
FAILED  : 1

WARNING: 1 site(s) FAILED. Their sharing setting is unchanged - re-run for those URLs:
  https://contoso.sharepoint.com/sites/finance
```

And the refusal that matters — asking for a level above the tenant ceiling stops before a single site is touched:

```text
Tenant ceiling: ExternalUserSharingOnly
Cannot set sites to 'ExternalUserAndGuestSharing': the tenant is
'ExternalUserSharingOnly', and a site can never be more permissive than the
tenant. Raise the tenant setting first, deliberately.
```

### Set-SiteDefaultLinkPermission.ps1 — ⚠️ writes

```text
Tenant default link permission: Edit
110 site(s) in scope.
Backup written to .\DefaultLinkPermission_Backup_20260901-101500.csv
  changed  https://contoso.sharepoint.com/sites/projects  Edit -> View
  skipped  https://contoso.sharepoint.com/sites/wiki      already View
  SKIPPED  https://contoso.sharepoint.com/sites/archive   sharing is Disabled - setting would have no effect

Changed : 88
Skipped : 22 (14 already at target, 6 sharing disabled, 2 locked)
FAILED  : 0
```

### Set-SiteAccessRequestSettings.ps1 — ⚠️ writes

The whole *Access Requests Settings* dialog. Current state is printed before anything changes, together with the tenant override that can make one of the settings cosmetic:

```text
*** This script CHANGES site access request settings. Run with -WhatIf first. ***
Backup written to .\AccessRequestSettings_Backup_20260901-101500.csv

https://contoso.sharepoint.com/sites/projects
  current  MembersCanShare=True  MembersCanInvite=True  AccessRequests=owners group  Message=(none)
  tenant   member sharing override: Unspecified (not overridden)
  changed  access requests -> helpdesk@contoso.com
  changed  custom message set (31 chars)

Changed : 2 setting(s) across 1 site(s)
Skipped : 0
FAILED  : 0
```

Two skips that are easy to mistake for success, so they are printed as skips:

```text
  SKIPPED  MembersCanShare - blocked by the tenant-wide override, the write would be cosmetic
  SKIPPED  MembersCanInvite - this site has no associated members group
```

The backup CSV of either script is the rollback — it holds the previous value per site:

```csv
Url,Title,DefaultLinkPermissionBefore,DefaultSharingLinkType,SharingCapability,LockState,CapturedUtc
https://contoso.sharepoint.com/sites/projects,Projects,Edit,Direct,ExternalUserSharingOnly,Unlock,2026-09-01T08:15:00.0000000Z
```

---

## lists-and-libraries/

### Get-ListInventory.ps1

```text
Scanning https://contoso.sharepoint.com/sites/intranet ...
  30 list(s)/librar(ies) inventoried.

Done. 30 row(s) written to C:\reports\ListInventory.csv
1 librar(ies)/list(s) keep UNLIMITED versions - the usual storage culprit.
```

```csv
SiteUrl,Title,Kind,BaseTemplate,ItemCount,OverViewThreshold,VersioningEnabled,MajorVersionLimit,VersionPolicy,ContentTypesOn,UniquePermissions
https://contoso.sharepoint.com/sites/intranet,Documents,Library,101,842,False,True,500,Keep 500 major versions,True,False
https://contoso.sharepoint.com/sites/intranet,Site Pages,Library,119,7,False,True,0,"Unlimited major versions, drafts kept for ALL major versions",True,False
```

That second row is the whole point of the [`MajorVersionLimit: 0`](../gotchas/lists/major-version-limit-zero-means-unlimited.md) gotcha: raw values of `0` and `0`, spelled out as *unlimited* twice.

### Get-ListIndexAdvice.ps1

```text
  22 list(s) at or above 2000 items.
  Contracts: 12 480 items, NO indexed column
  Archive: index limit reached (20/20)

Done. 22 list(s) written to C:\reports\ListIndexAdvice.csv
1 list(s) are past 5,000 items with no index at all - those are already breaking views.
```

### Get-CheckedOutFilesReport.ps1

```text
Scanning https://contoso.sharepoint.com/sites/projects ...
  Documents: 3 checked-out file(s)

Done. 3 row(s) written to C:\reports\CheckedOutFiles.csv
1 file(s) have no checked-in version - nobody but the uploader can see them.
```

```csv
SiteUrl,Library,FileName,FilePath,CheckedOutTo,Modified,DaysCheckedOut,Version,NeverCheckedIn
https://contoso.sharepoint.com/sites/projects,Documents,Tender draft.docx,/sites/projects/Shared Documents/Tender draft.docx,Megan Bowen,2026-02-11 16:03:41,168,0.1,True
```

### Get-ContentTypeUsage.ps1

```text
Scanning https://contoso.sharepoint.com/sites/intranet ...
  Site content type: Project Document  (0x0101008B2A...)
  59 list content type binding(s) found.

Done. 59 row(s) written to C:\reports\ContentTypeUsage.csv
```

### Get-LongFileUrlReport.ps1

```text
  Documents (842 items) ...
  Site Pages (7 items) ...

Done. 15 problem file(s) written to C:\reports\LongFileUrls.csv

Ten longest:

UrlLength NameLength FileName
--------- ---------- --------
      121         43 Novinkovy-hub--prehled-na-jednom-miste.aspx
      109         30 __rectSitelogo__Contoso.svg
```

---

## cleanup/

### Get-FileVersionBloatReport.ps1

```text
Scanning https://contoso.sharepoint.com/sites/media ...
  Documents ...
  Site Assets ...

Library summary -> C:\reports\VersionBloat_Libraries.csv
Per-file detail -> C:\reports\VersionBloat_Files.csv
Version history in scope: 41,7 GB across 318 file(s).

Ten worst offenders:

Library   FileName            CurrentMB VersionsMB VersionCount
-------   --------            --------- ---------- ------------
Documents Product launch.pptx     84,20    3115,40           37
Documents Price list.xlsx          6,10     915,00          150
```

When something cannot be read, the totals are labelled as a floor:

```text
INCOMPLETE: 0 site(s) and 12 file(s) could not be read.
Any total below is a floor, not the answer.
```

### Remove-ExcessFileVersions.ps1 — ⚠️ writes

Always start here, with `-WhatIf`:

```text
*** Version deletion is PERMANENT - trimmed versions do not go to the recycle bin. ***
Site: https://contoso.sharepoint.com/sites/media | Library: Documents | Keeping newest 10 version(s) per file

142 file(s) at or above 5 MB.
  would trim Product launch.pptx (27 of 37 versions, 2274,10 MB)
  would trim Price list.xlsx (140 of 150 versions, 854,00 MB)

Files examined : 142
Files skipped  : 0 (unreadable version history)
Versions removed: 0
Storage freed  : 0 MB
```

Without `-WhatIf` the same lines read `trimmed …`. Note the skip counter — a file whose history could not be read is never trimmed, and the count is printed even when it is zero.

### Get-RecycleBinReport.ps1

```text
Scanning https://contoso.sharepoint.com/sites/projects ...
  FirstStage: 1 284 item(s)
  SecondStage: 96 item(s)

Done. 1380 item(s), 3,12 GB, written to C:\reports\RecycleBin.csv

Biggest deleters:

DeletedBy          Items    MB
---------          -----    --
megan@contoso.com    902 2140,3
alex@contoso.com     311  680,1

14 item(s) will be purged within a week - restore now or lose them.
```

Denied access, as a real run produced it:

```text
WARNING: https://contoso.sharepoint.com/sites/intranet / FirstStage: Access is denied. (Exception from HRESULT: 0x80070005 (E_ACCESSDENIED))
WARNING: https://contoso.sharepoint.com/sites/intranet / SecondStage: Access is denied. (Exception from HRESULT: 0x80070005 (E_ACCESSDENIED))

2 recycle bin read(s) FAILED - this report is INCOMPLETE.
Reading the second-stage bin needs site collection administrator rights.
Done, but nothing could be read. This is NOT evidence that the bins are empty.
```

### Get-DeletedSitesReport.ps1

```text
Done. 2 deleted site(s) written to C:\reports\DeletedSites.csv

2 site(s) leave the recycle bin within 14 days:

Url                                              DeletedOn           DaysRemaining
---                                              ---------           -------------
https://contoso.sharepoint.com/sites/oldproject  2026-04-30 11:02:18             2
Restore with: Restore-SPODeletedSite -Identity <url>
```

### Get-DuplicateFilesReport.ps1

```text
Query: IsDocument:1 AND (Path:"https://contoso.sharepoint.com/sites/projects")
1 842 document(s) returned by search.

Done. 37 duplicate group(s), 94 file(s), written to C:\reports\DuplicateFiles.csv
Storage held by redundant copies: 2,41 GB

Ten most wasteful groups:

FileName              SizeMB Copies WastedMB
--------              ------ ------ --------
Company handbook.pdf   18,40      6    92,00
```

If the index answers without a `Size` on any row, the script refuses to conclude:

```text
WARNING: Not one result carries a Size value. The managed property did not come back - the grouping
below cannot be trusted. Aborting instead of reporting a clean result.
```

---

## search/

### Test-SearchManagedProperty.ps1

```text
Base query: IsDocument:1
Control OK: invented property names are rejected, so a "missing" verdict below is meaningful.
Sampling 25 row(s) per property.

Property                Exists Sortable RowsSampled RowsWithData Filterable FilterHits Verdict
--------                ------ -------- ----------- ------------ ---------- ---------- -------
ViewableByExternalUsers   True     True          25           25       True       1951 Exists and carries data
RefinableString00         True     True          25            0      False          0 Exists in the schema but
                                                                                       empty here - likely never
                                                                                       mapped or not crawled yet
ContentTypeId             True    False          25           25      False          0 Exists and carries data
ZzTotallyMadeUp42        False    False          25            0      False          0 DOES NOT EXIST - anything
                                                                                       built on it returns empty
                                                                                       forever
```

Four different real answers, which is the whole point: a fabricated name, a real-but-unmapped `RefinableString00`, a real-but-unsortable `ContentTypeId`, and one that works. `selectproperties` alone reports the first two identically.

---

## A note on the failure samples

Four of the samples above are failures, and three of them are failures the scripts originally reported as clean results — `Done. Recycle bins are empty.`, `Done. Nothing found.`, `Done. No file version history above the thresholds.` They were found by running the scripts against a tenant where the signed-in account did not have Full Control, which turned out to be the single most productive test condition available: everything works on a tenant where you are an admin.

If you write your own reporting scripts, borrow the shape rather than the code: count what you could not read, and let that count reach the last line of output.
