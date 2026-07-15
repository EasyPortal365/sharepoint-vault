<#
.SYNOPSIS
    Finds lists and libraries approaching (or past) the 5,000-item list view threshold.

.DESCRIPTION
    Connects to one or more SharePoint Online sites and reports every visible
    list or library whose item count is at or above the given threshold.
    The default threshold of 4,000 gives you an early warning before the
    5,000-item hard limit starts breaking views and filtered queries.

    READ-ONLY: this script makes no changes.

    Related gotcha in this repo:
    gotchas/lists/list-view-threshold-and-indexes.md

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID (application ID) of the Entra ID app registration used by
    PnP.PowerShell. Since PnP.PowerShell 2.12 you must register your own app:
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER Threshold
    Item count at which a list is included in the report. Default: 4000.

.PARAMETER OutputPath
    Path of the CSV file to create. Defaults to a timestamped file in the
    current directory. Nothing is written when no list qualifies.

.EXAMPLE
    .\Get-LargeListsReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-LargeListsReport.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000 -Threshold 3000

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site; the token is typically
               reused across sites of the same tenant within one session.
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
    [int]$Threshold = 4000,

    [string]$OutputPath = ".\LargeListsReport_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan
    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $largeLists = @(Get-PnPList | Where-Object { -not $_.Hidden -and $_.ItemCount -ge $Threshold })

        foreach ($list in $largeLists) {
            $report.Add([pscustomobject]@{
                SiteUrl          = $url
                ListTitle        = $list.Title
                ItemCount        = $list.ItemCount
                BaseTemplate     = $list.BaseTemplate
                LastItemModified = $list.LastItemUserModifiedDate
                OverHardLimit    = ($list.ItemCount -ge 5000)
            })
            Write-Host ("  {0}: {1:N0} items" -f $list.Title, $list.ItemCount) -ForegroundColor Yellow
        }

        if ($largeLists.Count -eq 0) {
            Write-Host '  Nothing at or above the threshold.' -ForegroundColor Green
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} large list(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
}
else {
    Write-Host 'Done. No lists at or above the threshold - nothing to export.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
