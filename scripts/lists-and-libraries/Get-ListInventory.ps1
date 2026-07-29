<#
.SYNOPSIS
    Full inventory of every list and library on a site: template, item count,
    versioning policy, content types, unique permissions and last activity.

.DESCRIPTION
    The report you build a migration plan, a versioning cleanup or a
    governance review on. One row per list, with the settings that actually
    cost money or cause incidents.

    READ-ONLY: this script makes no changes.

    Versioning is reported honestly, because SharePoint encodes "unlimited"
    as zero: MajorVersionLimit = 0 means *unlimited versions* when versioning
    is ON, and means nothing at all when versioning is OFF. A report that
    prints "0" in both cases invites somebody to conclude that the library
    keeps no versions, when in fact it keeps all of them forever.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell has no list-level cmdlets.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER IncludeHidden
    Also report hidden lists (the plumbing SharePoint creates for itself).

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-ListInventory.ps1 -SiteUrl https://contoso.sharepoint.com/sites/intranet -ClientId 00000000-0000-0000-0000-000000000000

    Scanning https://contoso.sharepoint.com/sites/intranet ...
      30 list(s)/librar(ies) inventoried.

    Done. 30 row(s) written to .\ListInventory_20260729-143912.csv
    1 librar(ies)/list(s) keep UNLIMITED versions - the usual storage culprit.

    Two rows, showing why the raw numbers are never printed on their own:
    Title,Kind,ItemCount,VersioningEnabled,MajorVersionLimit,VersionPolicy
    Documents,Library,842,True,500,Keep 500 major versions
    Site Pages,Library,7,True,0,"Unlimited major versions, drafts kept for ALL
    major versions"

    Both zeroes on the second row mean "unlimited", not "none".

.EXAMPLE
    .\Get-ListInventory.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000 -IncludeHidden

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [switch]$IncludeHidden,

    [string]$OutputPath = ".\ListInventory_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

$includes = @(
    'Hidden', 'ItemCount', 'BaseTemplate', 'BaseType', 'Created',
    'LastItemUserModifiedDate', 'EnableVersioning', 'EnableMinorVersions',
    'MajorVersionLimit', 'MajorWithMinorVersionsLimit', 'ContentTypesEnabled',
    'HasUniqueRoleAssignments', 'EnableAttachments', 'EnableFolderCreation',
    'DefaultViewUrl', 'ForceCheckout', 'NoCrawl'
)

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $lists = @(Get-PnPList -Includes $includes)
        if (-not $IncludeHidden) {
            $lists = @($lists | Where-Object { -not $_.Hidden })
        }

        foreach ($list in $lists) {
            # "0" is unlimited when versioning is on, and meaningless when it is off.
            $versionPolicy = 'Versioning OFF'
            if ($list.EnableVersioning) {
                if ($list.MajorVersionLimit -eq 0) {
                    $versionPolicy = 'Unlimited major versions'
                }
                else {
                    $versionPolicy = ('Keep {0} major versions' -f $list.MajorVersionLimit)
                }
                if ($list.EnableMinorVersions) {
                    # Zero is "unlimited" here too - printing the raw 0 reads as
                    # "keeps no drafts", the exact opposite of what it means.
                    if ($list.MajorWithMinorVersionsLimit -eq 0) {
                        $versionPolicy += ', drafts kept for ALL major versions'
                    }
                    else {
                        $versionPolicy += (', drafts for {0} major versions' -f $list.MajorWithMinorVersionsLimit)
                    }
                }
            }

            $report.Add([pscustomobject]@{
                SiteUrl            = $url
                Title              = $list.Title
                Url                = $list.DefaultViewUrl
                Kind               = if ($list.BaseType -eq 'DocumentLibrary') { 'Library' } else { 'List' }
                BaseTemplate       = $list.BaseTemplate
                ItemCount          = $list.ItemCount
                OverViewThreshold  = ($list.ItemCount -ge 5000)
                VersioningEnabled  = $list.EnableVersioning
                MinorVersions      = $list.EnableMinorVersions
                MajorVersionLimit  = $list.MajorVersionLimit
                VersionPolicy      = $versionPolicy
                ContentTypesOn     = $list.ContentTypesEnabled
                UniquePermissions  = $list.HasUniqueRoleAssignments
                ForceCheckout      = $list.ForceCheckout
                FolderCreation     = $list.EnableFolderCreation
                ExcludedFromSearch = $list.NoCrawl
                Hidden             = $list.Hidden
                Created            = $list.Created
                LastItemModified   = $list.LastItemUserModifiedDate
            })
        }

        Write-Host ("  {0} list(s)/librar(ies) inventoried." -f $lists.Count) -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

    $unlimited = @($report | Where-Object { $_.VersionPolicy -eq 'Unlimited major versions' })
    if ($unlimited.Count -gt 0) {
        Write-Host ("{0} librar(ies)/list(s) keep UNLIMITED versions - the usual storage culprit." -f $unlimited.Count) -ForegroundColor Yellow
    }

    $big = @($report | Where-Object { $_.OverViewThreshold })
    if ($big.Count -gt 0) {
        Write-Host ("{0} are past the 5,000-item view threshold." -f $big.Count) -ForegroundColor Yellow
    }
}
else {
    Write-Host 'Done. Nothing to export.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
