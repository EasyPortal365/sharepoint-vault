<#
.SYNOPSIS
    Reports what is sitting in a site's recycle bins, how much space it
    holds, and when it will age out.

.DESCRIPTION
    Both recycle bin stages count against the site quota, and the second
    stage is invisible to ordinary users - so a site can be "full" while its
    libraries look modest. The combined retention is 93 days from deletion,
    and moving an item from the first stage to the second does NOT restart
    that clock.

    The report groups by who deleted what and when, which is usually enough
    to tell an ordinary cleanup from somebody having emptied a library by
    accident.

    READ-ONLY: nothing is restored and nothing is purged. Emptying the
    second-stage bin is irreversible and stays a deliberate human action.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell has no recycle bin cmdlets at site level.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER RowLimit
    Maximum items to pull per stage per site. Default 5000. The script tells
    you when it hit the cap instead of implying the bin is that size.

.PARAMETER OutputPath
    CSV file with one row per deleted item. Defaults to a timestamped file.

.EXAMPLE
    .\Get-RecycleBinReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-RecycleBinReport.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000 -RowLimit 20000

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in; the second-stage bin needs
               site collection administrator rights.
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

    [ValidateRange(100, 200000)]
    [int]$RowLimit = 5000,

    [string]$OutputPath = ".\RecycleBin_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

# A read that failed is not a bin that is empty. Counted here so the closing
# summary can tell the two apart instead of reporting silence as cleanliness.
$failedReads = 0

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        foreach ($stage in @('FirstStage', 'SecondStage')) {
            $items = @()
            try {
                if ($stage -eq 'FirstStage') {
                    $items = @(Get-PnPRecycleBinItem -FirstStage -RowLimit $RowLimit)
                }
                else {
                    $items = @(Get-PnPRecycleBinItem -SecondStage -RowLimit $RowLimit)
                }
            }
            catch {
                Write-Warning ("{0} / {1}: {2}" -f $url, $stage, $_.Exception.Message)
                $failedReads++
                continue
            }

            if ($items.Count -ge $RowLimit) {
                Write-Warning ("{0} / {1}: hit the -RowLimit of {2}. The real bin is larger than this report." -f $url, $stage, $RowLimit)
            }

            foreach ($item in $items) {
                $deleted = [datetime]$item.DeletedDate
                $age = [int]((Get-Date) - $deleted).TotalDays

                $report.Add([pscustomobject]@{
                    SiteUrl       = $url
                    Stage         = $stage
                    Title         = $item.Title
                    ItemType      = $item.ItemType
                    OriginalPath  = $item.DirName
                    SizeMB        = [math]::Round([int64]$item.Size / 1MB, 3)
                    DeletedBy     = $item.DeletedByEmail
                    DeletedDate   = $deleted
                    AgeDays       = $age
                    DaysUntilPurge = [math]::Max(0, 93 - $age)
                })
            }

            Write-Host ("  {0}: {1} item(s)" -f $stage, $items.Count)
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
        $failedReads++
    }
}

Write-Host ''
if ($failedReads -gt 0) {
    Write-Host ("{0} recycle bin read(s) FAILED - this report is INCOMPLETE." -f $failedReads) -ForegroundColor Red
    Write-Host 'Reading the second-stage bin needs site collection administrator rights.' -ForegroundColor Red
}

if ($report.Count -gt 0) {
    $report | Sort-Object DeletedDate -Descending | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    $totalGB = [math]::Round((($report | Measure-Object SizeMB -Sum).Sum) / 1024, 2)
    Write-Host ("Done. {0} item(s), {1} GB, written to {2}" -f $report.Count, $totalGB, (Resolve-Path $OutputPath)) -ForegroundColor Green

    Write-Host ''
    Write-Host 'Biggest deleters:' -ForegroundColor Cyan
    $report | Group-Object DeletedBy |
        Select-Object @{ N = 'DeletedBy'; E = { $_.Name } },
                      @{ N = 'Items';     E = { $_.Count } },
                      @{ N = 'MB';        E = { [math]::Round(($_.Group | Measure-Object SizeMB -Sum).Sum, 1) } } |
        Sort-Object MB -Descending | Select-Object -First 10 | Format-Table -AutoSize

    $expiring = @($report | Where-Object { $_.DaysUntilPurge -le 7 })
    if ($expiring.Count -gt 0) {
        Write-Host ("{0} item(s) will be purged within a week - restore now or lose them." -f $expiring.Count) -ForegroundColor Yellow
    }
}
elseif ($failedReads -gt 0) {
    Write-Host 'Done, but nothing could be read. This is NOT evidence that the bins are empty.' -ForegroundColor Red
}
else {
    Write-Host 'Done. Recycle bins are empty.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
