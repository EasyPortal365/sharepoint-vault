<#
.SYNOPSIS
    Reports which large lists have no useful indexed columns - and how many
    of the 20 allowed indexes each list has left.

.DESCRIPTION
    The 5,000-item list view threshold is about *scanned* rows, not returned
    rows: a filter on an unindexed column has to walk the whole list, so it
    fails the moment the list crosses the limit. An index on the filtered
    column turns the same query into a seek and it works again.

    This script pairs item counts with the actual index situation per list:
    which columns are indexed, how many index slots remain (SharePoint allows
    20 per list), and which lists are big enough to be at risk while carrying
    no index at all.

    READ-ONLY: this script creates no indexes. Adding one is a write against
    a live list and belongs in a change window, not in a report.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell has no list- or field-level cmdlets.

    Related gotcha in this repo:
    gotchas/lists/list-view-threshold-and-indexes.md

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER MinItemCount
    Only examine lists with at least this many items. Default 2000.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-ListIndexAdvice.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-ListIndexAdvice.ps1 -SiteUrl https://contoso.sharepoint.com/sites/archive -ClientId 00000000-0000-0000-0000-000000000000 -MinItemCount 500

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site.
    Caveat   : Creating an index on a list that is already over the threshold
               can itself fail during the day; SharePoint runs index creation
               as a background job on large lists. Schedule it off-hours.
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MinItemCount = 2000,

    [string]$OutputPath = ".\ListIndexAdvice_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

$maxIndexesPerList = 20

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $lists = @(Get-PnPList -Includes Hidden, ItemCount |
            Where-Object { -not $_.Hidden -and $_.ItemCount -ge $MinItemCount })

        Write-Host ("  {0} list(s) at or above {1:N0} items." -f $lists.Count, $MinItemCount)

        foreach ($list in $lists) {
            $fields  = @(Get-PnPField -List $list)
            $indexed = @($fields | Where-Object { $_.Indexed })

            # Columns people habitually filter or group by.
            $candidates = @($fields | Where-Object {
                -not $_.Indexed -and -not $_.Hidden -and
                $_.InternalName -in @('Modified', 'Created', 'Editor', 'Author', 'Status', 'Category', 'FileLeafRef')
            })

            $report.Add([pscustomobject]@{
                SiteUrl          = $url
                ListTitle        = $list.Title
                ItemCount        = $list.ItemCount
                OverHardLimit    = ($list.ItemCount -ge 5000)
                IndexedColumns   = (($indexed | Select-Object -ExpandProperty InternalName) -join ', ')
                IndexCount       = $indexed.Count
                IndexSlotsLeft   = ($maxIndexesPerList - $indexed.Count)
                AtIndexLimit     = ($indexed.Count -ge $maxIndexesPerList)
                NoIndexAtAll     = ($indexed.Count -eq 0)
                SuggestedColumns = (($candidates | Select-Object -ExpandProperty InternalName) -join ', ')
            })

            if ($indexed.Count -eq 0) {
                Write-Host ("  {0}: {1:N0} items, NO indexed column" -f $list.Title, $list.ItemCount) -ForegroundColor Yellow
            }
            elseif ($indexed.Count -ge $maxIndexesPerList) {
                Write-Host ("  {0}: index limit reached ({1}/{1})" -f $list.Title, $maxIndexesPerList) -ForegroundColor Yellow
            }
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} list(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

    $urgent = @($report | Where-Object { $_.OverHardLimit -and $_.NoIndexAtAll })
    if ($urgent.Count -gt 0) {
        Write-Host ("{0} list(s) are past 5,000 items with no index at all - those are already breaking views." -f $urgent.Count) -ForegroundColor Red
    }
}
else {
    Write-Host ("Done. No list reaches {0:N0} items." -f $MinItemCount) -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
