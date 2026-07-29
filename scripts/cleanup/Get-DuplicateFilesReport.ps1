<#
.SYNOPSIS
    Finds duplicate documents across a site, a site collection or the whole
    tenant, using the search index.

.DESCRIPTION
    Duplicates get created by copy-paste migrations, "final_v2" habits and
    people re-uploading what they could not find. Crawling every library
    with REST to find them takes hours; the search index already knows the
    file name and the exact byte size of everything it has crawled, so one
    query answers the question in seconds.

    Files are grouped by name + size, which is the pragmatic definition:
    same name and byte-identical size is a duplicate in practice, and
    SharePoint does not expose a content hash you could use instead.

    READ-ONLY: this script deletes nothing.

    Two honest limits, both surfaced by the script rather than hidden:

      * Search only knows what it has crawled. A file uploaded ten minutes
        ago is missing from this report, and a library with NoCrawl set is
        missing entirely. This finds duplicates; it does not prove absence.
      * Search deduplicates result rows by default, which would hide exactly
        what we are looking for - TrimDuplicates is therefore turned off.

.PARAMETER SiteUrl
    Site to connect to. Also the default search scope.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER Scope
    Site        - only the connected site (default)
    SiteCollection - the site collection the connected site belongs to
    Tenant      - everything the signed-in user can see

.PARAMETER MinSizeKB
    Ignore files below this size. Default 100 - tiny duplicates are noise
    and there are thousands of them.

.PARAMETER MinCopies
    Only report groups with at least this many copies. Default 2.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-DuplicateFilesReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-DuplicateFilesReport.ps1 -SiteUrl https://contoso.sharepoint.com -ClientId 00000000-0000-0000-0000-000000000000 -Scope Tenant -MinSizeKB 1024

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in. Search results are security
               trimmed - you only see duplicates you have access to.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [ValidateSet('Site', 'SiteCollection', 'Tenant')]
    [string]$Scope = 'Site',

    [ValidateRange(0, [int]::MaxValue)]
    [int]$MinSizeKB = 100,

    [ValidateRange(2, 1000)]
    [int]$MinCopies = 2,

    [string]$OutputPath = ".\DuplicateFiles_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'

Write-Host "Connecting to $SiteUrl ..." -ForegroundColor Cyan
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

# The scope filter is parenthesised on purpose: KQL binds AND tighter than
# OR, so an unbracketed scope clause can be escaped by any OR in the query.
switch ($Scope) {
    'Site'           { $scopeClause = (' AND (Path:"{0}")' -f $SiteUrl) }
    'SiteCollection' { $scopeClause = (' AND (SPSiteUrl:"{0}")' -f $SiteUrl) }
    'Tenant'         { $scopeClause = '' }
}

$query = 'IsDocument:1' + $scopeClause
Write-Host ("Query: {0}" -f $query) -ForegroundColor DarkGray

$result = Submit-PnPSearchQuery -Query $query -All -TrimDuplicates:$false -SelectProperties @(
    'Path', 'FileName', 'Title', 'FileType', 'Size', 'LastModifiedTime', 'SPWebUrl', 'ModifiedBy'
)

$rows = @($result.ResultRows)
Write-Host ("{0} document(s) returned by search." -f $rows.Count) -ForegroundColor Cyan

if ($rows.Count -eq 0) {
    Write-Host 'Search returned nothing. Either the scope is wrong or the content is not indexed - it is not proof that the site is empty.' -ForegroundColor Yellow
    try { Disconnect-PnPOnline } catch { }
    return
}

# Control check: if Size never comes back, grouping by size is meaningless
# and a "no duplicates" answer would be a lie.
$withSize = @($rows | Where-Object { $_['Size'] })
if ($withSize.Count -eq 0) {
    Write-Warning 'Not one result carries a Size value. The managed property did not come back - the grouping below cannot be trusted. Aborting instead of reporting a clean result.'
    try { Disconnect-PnPOnline } catch { }
    return
}
if ($withSize.Count -lt $rows.Count) {
    Write-Warning ("{0} of {1} results have no Size and were skipped." -f ($rows.Count - $withSize.Count), $rows.Count)
}

$minBytes = [int64]$MinSizeKB * 1024

$candidates = $withSize | ForEach-Object {
    [pscustomobject]@{
        FileName     = [string]$_['FileName']
        SizeBytes    = [int64]$_['Size']
        Path         = [string]$_['Path']
        WebUrl       = [string]$_['SPWebUrl']
        FileType     = [string]$_['FileType']
        LastModified = $_['LastModifiedTime']
        ModifiedBy   = [string]$_['ModifiedBy']
    }
} | Where-Object { $_.SizeBytes -ge $minBytes }

$groups = @($candidates |
    Group-Object -Property { '{0}|{1}' -f $_.FileName.ToLowerInvariant(), $_.SizeBytes } |
    Where-Object { $_.Count -ge $MinCopies })

$report = New-Object System.Collections.Generic.List[object]
$groupNo = 0

foreach ($g in ($groups | Sort-Object { ($_.Group[0].SizeBytes) * ($_.Count - 1) } -Descending)) {
    $groupNo++
    $sizeMB = [math]::Round($g.Group[0].SizeBytes / 1MB, 2)

    foreach ($f in ($g.Group | Sort-Object LastModified -Descending)) {
        $report.Add([pscustomobject]@{
            Group        = $groupNo
            FileName     = $f.FileName
            SizeMB       = $sizeMB
            Copies       = $g.Count
            WastedMB     = [math]::Round(($f.SizeBytes * ($g.Count - 1)) / 1MB, 2)
            Path         = $f.Path
            WebUrl       = $f.WebUrl
            FileType     = $f.FileType
            LastModified = $f.LastModified
            ModifiedBy   = $f.ModifiedBy
        })
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

    $wasted = ($groups | ForEach-Object { $_.Group[0].SizeBytes * ($_.Count - 1) } | Measure-Object -Sum).Sum
    Write-Host ("Done. {0} duplicate group(s), {1} file(s), written to {2}" -f $groups.Count, $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
    Write-Host ("Storage held by redundant copies: {0} GB" -f [math]::Round($wasted / 1GB, 2)) -ForegroundColor Yellow

    Write-Host ''
    Write-Host 'Ten most wasteful groups:' -ForegroundColor Cyan
    $report | Where-Object { $_.Group -le 10 } |
        Group-Object Group |
        ForEach-Object { $_.Group[0] } |
        Format-Table FileName, SizeMB, Copies, WastedMB -AutoSize
}
else {
    Write-Host ("Done. No file appears {0}+ times at the same size above {1} KB." -f $MinCopies, $MinSizeKB) -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
