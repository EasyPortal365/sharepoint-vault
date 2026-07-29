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

    Speed: the work is done with REST, one request per object, because the
    CSOM path costs two round trips per role assignment and one per item.
    On a 30-list site that difference is minutes versus seconds - the first
    version of this script appeared to hang because it made several hundred
    sequential calls with no output in between.

      web/list permissions   /_api/.../roleassignments?$expand=Member,RoleDefinitionBindings
      which items are unique /_api/.../items?$select=Id,HasUniqueRoleAssignments,...

    The item query returns the flag for every item in one page, so item-level
    scanning costs one request per list plus one per item that actually has
    unique permissions - not one per item.

    Note on filtering: the item query deliberately does NOT use
    $filter=HasUniqueRoleAssignments eq true. Server-side boolean filters on
    SharePoint have been observed returning the wrong set, and on a
    permissions report a wrong set is worse than a slow one. Items are
    filtered client-side.

    Module note: uses PnP.PowerShell for authentication and its REST helper;
    the official SharePoint Online Management Shell has no list- or
    item-level cmdlets.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER IncludeItems
    Also check individual list items and files.

.PARAMETER MaxItemsPerList
    Safety cap for -IncludeItems. Default 5000.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-UniquePermissionsReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-UniquePermissionsReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/hr -ClientId 00000000-0000-0000-0000-000000000000 -IncludeItems

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site. Reading role
               assignments needs Full Control or Manage Permissions on the
               object - an Edit-level account gets
               "Attempted to perform an unauthorized operation", which this
               script reports as a failure, never as "no unique permissions".
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

    [switch]$IncludeItems,

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxItemsPerList = 5000,

    [string]$OutputPath = ".\UniquePermissions_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

# Objects we could not read. Kept separate from "no unique permissions found"
# so the closing summary can never pass one off as the other.
$failedReads = New-Object System.Collections.Generic.List[string]

function Get-RoleAssignments {
    <#
        One request returns every principal and its roles for an object.
        Returns $null when the read failed - which is NOT the same as an
        object that simply has no assignments.
    #>
    param([string]$RelativeApiPath, [string]$Label)

    try {
        $res = Invoke-PnPSPRestMethod -Method Get -Url ("{0}/roleassignments?`$expand=Member,RoleDefinitionBindings" -f $RelativeApiPath)
    }
    catch {
        $msg = $_.Exception.Message
        if ($msg -match '"value":"([^"]{0,120})') { $msg = $matches[1] }
        Write-Warning ("{0}: {1}" -f $Label, $msg)
        $script:failedReads.Add($Label)
        return $null
    }

    $lines = @()
    foreach ($ra in @($res.value)) {
        $roles = @($ra.RoleDefinitionBindings | Where-Object { $_.Name -ne 'Limited Access' } | ForEach-Object { $_.Name })
        if ($roles.Count -eq 0) { $roles = @('Limited Access') }
        $lines += ('{0} [{1}]' -f $ra.Member.Title, ($roles -join '+'))
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
            $principals = Get-RoleAssignments -RelativeApiPath '/_api/web' -Label ("{0} (web)" -f $url)
            if ($null -ne $principals) {
                $report.Add([pscustomobject]@{
                    SiteUrl = $url; Scope = 'Web'; Object = $web.ServerRelativeUrl
                    ItemCount = ''; Principals = $principals
                    Note = 'Site does not inherit from its parent'
                })
            }
        }

        # --- List level ------------------------------------------------
        $lists = @(Get-PnPList -Includes HasUniqueRoleAssignments, ItemCount, Hidden |
            Where-Object { -not $_.Hidden })

        $uniqueLists = @($lists | Where-Object { $_.HasUniqueRoleAssignments })
        Write-Host ("  {0} list(s), {1} with unique permissions." -f $lists.Count, $uniqueLists.Count)

        foreach ($list in $uniqueLists) {
            $api = "/_api/web/lists(guid'{0}')" -f $list.Id
            $principals = Get-RoleAssignments -RelativeApiPath $api -Label ("{0} / {1}" -f $url, $list.Title)
            if ($null -eq $principals) { continue }

            $report.Add([pscustomobject]@{
                SiteUrl = $url; Scope = 'List'; Object = $list.Title
                ItemCount = $list.ItemCount; Principals = $principals; Note = ''
            })
            Write-Host ("    list: {0}" -f $list.Title) -ForegroundColor Yellow
        }

        # --- Item level (opt-in) ---------------------------------------
        if ($IncludeItems) {
            $n = 0
            foreach ($list in $lists) {
                $n++
                if ($list.ItemCount -eq 0) { continue }
                Write-Host ("  [{0}/{1}] {2} ({3:N0} items) ..." -f $n, $lists.Count, $list.Title, $list.ItemCount)

                $api = "/_api/web/lists(guid'{0}')" -f $list.Id
                $top = [Math]::Min($MaxItemsPerList, 5000)

                try {
                    $items = Invoke-PnPSPRestMethod -Method Get -Url ("{0}/items?`$select=Id,HasUniqueRoleAssignments,FileLeafRef,Title&`$top={1}" -f $api, $top)
                }
                catch {
                    Write-Warning ("{0} / {1}: item read failed - {2}" -f $url, $list.Title, $_.Exception.Message)
                    $failedReads.Add(("{0} / {1} (items)" -f $url, $list.Title))
                    continue
                }

                $rows = @($items.value)
                if ($list.ItemCount -gt $rows.Count) {
                    Write-Warning ("{0}: read {1} of {2} items - the item rows for this list are PARTIAL." -f $list.Title, $rows.Count, $list.ItemCount)
                    $report.Add([pscustomobject]@{
                        SiteUrl = $url; Scope = 'List'; Object = $list.Title
                        ItemCount = $list.ItemCount; Principals = ''
                        Note = ("PARTIAL SCAN - only the first {0} items were checked" -f $rows.Count)
                    })
                }

                # Client-side filter on purpose - see the note in .DESCRIPTION.
                foreach ($row in ($rows | Where-Object { $_.HasUniqueRoleAssignments })) {
                    $name = $row.FileLeafRef
                    if (-not $name) { $name = $row.Title }

                    $principals = Get-RoleAssignments `
                        -RelativeApiPath ("{0}/items({1})" -f $api, $row.Id) `
                        -Label ("{0} / {1} / item {2}" -f $url, $list.Title, $row.Id)
                    if ($null -eq $principals) { continue }

                    $report.Add([pscustomobject]@{
                        SiteUrl = $url; Scope = 'Item'
                        Object = ('{0} / [{1}] {2}' -f $list.Title, $row.Id, $name)
                        ItemCount = ''; Principals = $principals; Note = ''
                    })
                }
            }
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
        $failedReads.Add($url)
    }
}

Write-Host ''
if ($failedReads.Count -gt 0) {
    Write-Host ("{0} object(s) could NOT be read - this report does not cover them:" -f $failedReads.Count) -ForegroundColor Red
    foreach ($f in ($failedReads | Select-Object -First 10)) { Write-Host ("  {0}" -f $f) -ForegroundColor Red }
    if ($failedReads.Count -gt 10) { Write-Host ("  ... and {0} more" -f ($failedReads.Count - 10)) -ForegroundColor Red }
    Write-Host 'Reading role assignments needs Full Control. Absence below is not evidence of inheritance.' -ForegroundColor Red
    Write-Host ''
}

if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
}
elseif ($failedReads.Count -gt 0) {
    Write-Host 'Done, but nothing could be read. This is NOT a finding of clean inheritance.' -ForegroundColor Red
}
else {
    Write-Host 'Done. Everything inherits - nothing to export.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
