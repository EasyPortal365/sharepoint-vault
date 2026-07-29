<#
.SYNOPSIS
    Finds broken permission inheritance across one or more sites - at web,
    list/library and (optionally) item level.

.DESCRIPTION
    Walks the site, every visible list and library, and reports each object
    that has unique role assignments, together with the principals that hold
    permissions on it. This is the report you want before a migration, an
    access review, or when someone asks "who can actually see this?".

    READ-ONLY: this script makes no changes.

    Cost warning: item-level scanning is opt-in (-IncludeItems) because
    SharePoint answers HasUniqueRoleAssignments per item, one round trip
    each. On a 10,000-item library that is 10,000 calls. -MaxItemsPerList
    caps the damage and the script tells you when it stopped early rather
    than silently reporting a partial list as complete.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell has no list- or item-level cmdlets.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER IncludeItems
    Also check individual list items and files. Slow - see cost warning.

.PARAMETER MaxItemsPerList
    Safety cap for -IncludeItems. Default 2000.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-UniquePermissionsReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-UniquePermissionsReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/hr -ClientId 00000000-0000-0000-0000-000000000000 -IncludeItems -MaxItemsPerList 500

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site. Reading role
               assignments needs Full Control or Manage Permissions on the
               object - an Edit-level account gets 403 and the row is
               reported as "access denied", never as "no unique permissions".
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [switch]$IncludeItems,

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxItemsPerList = 2000,

    [string]$OutputPath = ".\UniquePermissions_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

function Get-RoleAssignmentSummary {
    param($ClientObject)

    $assignments = Get-PnPProperty -ClientObject $ClientObject -Property RoleAssignments
    $lines = @()

    foreach ($ra in $assignments) {
        $member = Get-PnPProperty -ClientObject $ra -Property Member
        $bindings = Get-PnPProperty -ClientObject $ra -Property RoleDefinitionBindings
        $roles = ($bindings | Where-Object { $_.Name -ne 'Limited Access' } | Select-Object -ExpandProperty Name) -join '+'
        if (-not $roles) { $roles = 'Limited Access' }
        $lines += ('{0} [{1}]' -f $member.Title, $roles)
    }

    return ($lines -join '; ')
}

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        # --- Web level -------------------------------------------------
        $web = Get-PnPWeb -Includes HasUniqueRoleAssignments, ServerRelativeUrl
        if ($web.HasUniqueRoleAssignments) {
            $report.Add([pscustomobject]@{
                SiteUrl    = $url
                Scope      = 'Web'
                Object     = $web.ServerRelativeUrl
                ItemCount  = ''
                Principals = Get-RoleAssignmentSummary -ClientObject $web
                Note       = 'Site does not inherit from its parent'
            })
        }

        # --- List level ------------------------------------------------
        $lists = @(Get-PnPList -Includes HasUniqueRoleAssignments, ItemCount, Hidden |
            Where-Object { -not $_.Hidden })

        foreach ($list in $lists) {
            if (-not $list.HasUniqueRoleAssignments) { continue }

            $report.Add([pscustomobject]@{
                SiteUrl    = $url
                Scope      = 'List'
                Object     = $list.Title
                ItemCount  = $list.ItemCount
                Principals = Get-RoleAssignmentSummary -ClientObject $list
                Note       = ''
            })
            Write-Host ("  list: {0}" -f $list.Title) -ForegroundColor Yellow
        }

        # --- Item level (opt-in) ---------------------------------------
        if ($IncludeItems) {
            foreach ($list in $lists) {
                if ($list.ItemCount -eq 0) { continue }

                $items = @(Get-PnPListItem -List $list -PageSize 500 -Fields 'ID', 'FileLeafRef', 'Title')
                $scanned = 0
                $truncated = $false

                foreach ($item in $items) {
                    if ($scanned -ge $MaxItemsPerList) { $truncated = $true; break }
                    $scanned++

                    $unique = Get-PnPProperty -ClientObject $item -Property HasUniqueRoleAssignments
                    if (-not $unique) { continue }

                    $name = $item['FileLeafRef']
                    if (-not $name) { $name = $item['Title'] }

                    $report.Add([pscustomobject]@{
                        SiteUrl    = $url
                        Scope      = 'Item'
                        Object     = ('{0} / [{1}] {2}' -f $list.Title, $item.Id, $name)
                        ItemCount  = ''
                        Principals = Get-RoleAssignmentSummary -ClientObject $item
                        Note       = ''
                    })
                }

                if ($truncated) {
                    Write-Warning ("{0}: stopped after {1} of {2} items (-MaxItemsPerList). The item rows for this list are PARTIAL." -f $list.Title, $MaxItemsPerList, $items.Count)
                    $report.Add([pscustomobject]@{
                        SiteUrl    = $url
                        Scope      = 'List'
                        Object     = $list.Title
                        ItemCount  = $items.Count
                        Principals = ''
                        Note       = ("PARTIAL SCAN - only the first {0} items were checked" -f $MaxItemsPerList)
                    })
                }
            }
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
        $report.Add([pscustomobject]@{
            SiteUrl    = $url
            Scope      = 'Error'
            Object     = ''
            ItemCount  = ''
            Principals = ''
            Note       = $_.Exception.Message
        })
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
}
else {
    Write-Host 'Done. Everything inherits - nothing to export.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
