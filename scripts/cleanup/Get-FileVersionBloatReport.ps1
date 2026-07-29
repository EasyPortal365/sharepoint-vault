<#
.SYNOPSIS
    Measures how much storage file version history is really consuming, per
    library and per file.

.DESCRIPTION
    Version history is the single most common reason a tenant runs out of
    storage, and it is invisible in every standard report: the library shows
    the size of the current files, the quota counts every version.

    This script sums the size of all versions per file and reports the
    libraries and files where history dwarfs the live content - typically
    large binaries (PSD, MP4, PPTX, Excel with embedded data) in libraries
    that keep unlimited versions.

    READ-ONLY: this script deletes nothing. Use Remove-ExcessFileVersions.ps1
    (same folder) once you have decided what to trim.

    Cost warning: version metadata is read per file. -MinFileSizeMB skips
    small files (which cannot be the problem anyway) and -MaxFilesPerLibrary
    caps the scan; when the cap is hit the script says the library figure is
    a floor rather than pretending it is complete.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell cannot reach library content.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER MinFileSizeMB
    Ignore files smaller than this. Default 5.

.PARAMETER MaxFilesPerLibrary
    Safety cap per library. Default 2000.

.PARAMETER OutputPath
    CSV file with one row per file. Defaults to a timestamped file.

.PARAMETER SummaryPath
    CSV file with one row per library. Defaults to a timestamped file.

.EXAMPLE
    .\Get-FileVersionBloatReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-FileVersionBloatReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/media -ClientId 00000000-0000-0000-0000-000000000000 -MinFileSizeMB 20

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site.
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [ValidateRange(0, 100000)]
    [int]$MinFileSizeMB = 5,

    [ValidateRange(1, [int]::MaxValue)]
    [int]$MaxFilesPerLibrary = 2000,

    [string]$OutputPath  = ".\VersionBloat_Files_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [string]$SummaryPath = ".\VersionBloat_Libraries_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$files     = New-Object System.Collections.Generic.List[object]
$summaries = New-Object System.Collections.Generic.List[object]

# Files and libraries we could not read. A storage report that answers "nothing
# to reclaim" after failing every read is worse than no report at all.
$failedFiles = 0
$failedSites = 0

$minBytes = [int64]$MinFileSizeMB * 1MB

$caml = @"
<View Scope="RecursiveAll">
  <Query>
    <Where><Geq><FieldRef Name="File_x0020_Size" /><Value Type="Number">$minBytes</Value></Geq></Where>
    <OrderBy><FieldRef Name="File_x0020_Size" Ascending="FALSE" /></OrderBy>
  </Query>
  <ViewFields>
    <FieldRef Name="FileLeafRef" />
    <FieldRef Name="FileRef" />
    <FieldRef Name="File_x0020_Size" />
    <FieldRef Name="Modified" />
    <FieldRef Name="_UIVersionString" />
  </ViewFields>
  <RowLimit Paged="TRUE">500</RowLimit>
</View>
"@

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $libraries = @(Get-PnPList -Includes Hidden, BaseType, ItemCount, EnableVersioning, MajorVersionLimit |
            Where-Object { -not $_.Hidden -and $_.BaseType -eq 'DocumentLibrary' })

        foreach ($lib in $libraries) {
            if ($lib.ItemCount -eq 0) { continue }
            Write-Host ("  {0} ..." -f $lib.Title)

            $items = @(Get-PnPListItem -List $lib -Query $caml -PageSize 500)
            if ($items.Count -eq 0) { continue }

            $truncated = $items.Count -gt $MaxFilesPerLibrary
            if ($truncated) { $items = $items[0..($MaxFilesPerLibrary - 1)] }

            $libCurrent  = [int64]0
            $libVersions = [int64]0
            $scanned     = 0

            foreach ($item in $items) {
                $currentSize = [int64]$item['File_x0020_Size']

                try {
                    # Load File through the item's own context. Reaching for $item.File
                    # directly throws "The object is used in the context different from
                    # the one associated with the object" once anything else has opened
                    # a second PnP connection in the same process.
                    $file = Get-PnPProperty -ClientObject $item -Property File
                    $versions = Get-PnPProperty -ClientObject $file -Property Versions
                }
                catch {
                    # Unreadable version metadata is not "no versions" - skip the file
                    # rather than folding a read failure into a zero.
                    Write-Warning ("{0}: could not read versions for {1} - {2}" -f $lib.Title, $item['FileLeafRef'], $_.Exception.Message)
                    $script:failedFiles++
                    continue
                }

                $versionBytes = [int64]0
                foreach ($v in $versions) { $versionBytes += [int64]$v.Size }

                $scanned++
                $libCurrent  += $currentSize
                $libVersions += $versionBytes

                if ($versionBytes -le 0) { continue }

                $files.Add([pscustomobject]@{
                    SiteUrl        = $url
                    Library        = $lib.Title
                    FileName       = $item['FileLeafRef']
                    FilePath       = $item['FileRef']
                    CurrentMB      = [math]::Round($currentSize / 1MB, 2)
                    VersionsMB     = [math]::Round($versionBytes / 1MB, 2)
                    VersionCount   = $versions.Count
                    TotalMB        = [math]::Round(($currentSize + $versionBytes) / 1MB, 2)
                    OverheadRatio  = if ($currentSize -gt 0) { [math]::Round($versionBytes / $currentSize, 1) } else { '' }
                    CurrentVersion = $item['_UIVersionString']
                    Modified       = $item['Modified']
                })
            }

            $summaries.Add([pscustomobject]@{
                SiteUrl          = $url
                Library          = $lib.Title
                FilesScanned     = $scanned
                CurrentMB        = [math]::Round($libCurrent / 1MB, 1)
                VersionsMB       = [math]::Round($libVersions / 1MB, 1)
                ReclaimableMB    = [math]::Round($libVersions / 1MB, 1)
                VersioningOn     = $lib.EnableVersioning
                VersionLimit     = if ($lib.EnableVersioning -and $lib.MajorVersionLimit -eq 0) { 'unlimited' } else { $lib.MajorVersionLimit }
                Completeness     = if ($truncated) { ("PARTIAL - first {0} files only, figures are a floor" -f $MaxFilesPerLibrary) } else { 'complete' }
            })
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
        $failedSites++
    }
}

Write-Host ''
if ($failedSites -gt 0 -or $failedFiles -gt 0) {
    Write-Host ("INCOMPLETE: {0} site(s) and {1} file(s) could not be read." -f $failedSites, $failedFiles) -ForegroundColor Red
    Write-Host 'Any total below is a floor, not the answer.' -ForegroundColor Red
    Write-Host ''
}

if ($summaries.Count -gt 0) {
    $summaries | Sort-Object VersionsMB -Descending | Export-Csv -Path $SummaryPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Library summary -> {0}" -f (Resolve-Path $SummaryPath)) -ForegroundColor Green
}
if ($files.Count -gt 0) {
    $files | Sort-Object VersionsMB -Descending | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Per-file detail -> {0}" -f (Resolve-Path $OutputPath)) -ForegroundColor Green

    $totalGB = [math]::Round((($files | Measure-Object VersionsMB -Sum).Sum) / 1024, 2)
    Write-Host ("Version history in scope: {0} GB across {1} file(s)." -f $totalGB, $files.Count) -ForegroundColor Yellow

    Write-Host ''
    Write-Host 'Ten worst offenders:' -ForegroundColor Cyan
    $files | Sort-Object VersionsMB -Descending | Select-Object -First 10 |
        Format-Table Library, FileName, CurrentMB, VersionsMB, VersionCount -AutoSize
}
elseif ($failedSites -gt 0 -or $failedFiles -gt 0) {
    Write-Host 'Done, but every read failed - this says nothing about version history.' -ForegroundColor Red
}
else {
    Write-Host 'Done. No file version history above the thresholds.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
