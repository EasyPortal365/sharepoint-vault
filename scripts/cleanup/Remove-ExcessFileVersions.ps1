<#
.SYNOPSIS
    *** THIS SCRIPT DELETES DATA *** Trims file version history in a library,
    keeping the newest N versions of each file.

.DESCRIPTION
    Deleting a file version is PERMANENT. Trimmed versions do not go to the
    recycle bin and cannot be restored. Run Get-FileVersionBloatReport.ps1
    first, agree the policy with whoever owns the content, and start with
    -WhatIf. The script supports -WhatIf and -Confirm and will not do
    anything on a first run unless you pass -Confirm:$false or answer the
    prompt.

    Safety rules built in, in order:

      1. -WhatIf by default in your head: the script prints exactly which
         versions it would remove, per file, before touching anything.
      2. A file whose version list cannot be READ is skipped, never trimmed.
         A read failure that falls through to an empty collection is how
         "trim to 10" becomes "delete everything" - so the read is strict.
      3. The current (published) version is never a candidate; only history.
      4. Oldest versions go first, and only the count above -KeepVersions.
      5. -MaxFilesToProcess caps a single run so a mistake stays small.

.PARAMETER SiteUrl
    Full URL of the site to work on.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER Library
    Title of the document library to trim.

.PARAMETER KeepVersions
    How many historical versions to keep per file. Default 10. Minimum 1 -
    this script will not strip a file's history down to nothing.

.PARAMETER MinFileSizeMB
    Only consider files at least this large. Default 5.

.PARAMETER MaxFilesToProcess
    Stop after this many files. Default 100.

.EXAMPLE
    .\Remove-ExcessFileVersions.ps1 -SiteUrl https://contoso.sharepoint.com/sites/media -ClientId 00000000-0000-0000-0000-000000000000 -Library Documents -WhatIf

    *** Version deletion is PERMANENT - trimmed versions do not go to the recycle bin. ***
    Site: https://contoso.sharepoint.com/sites/media | Library: Documents | Keeping newest 10 version(s) per file

    142 file(s) at or above 5 MB.
      would trim Product launch.pptx (27 of 37 versions, 2274.10 MB)
      would trim Price list.xlsx (140 of 150 versions, 854.00 MB)

    Files examined : 142
    Files skipped  : 0 (unreadable version history)
    Versions removed: 0
    Storage freed  : 0 MB

    Without -WhatIf the same lines read "trimmed ...". The skip counter is
    printed even at zero: a file whose history could not be read is never
    trimmed, and you should be able to see that it was left alone.

.EXAMPLE
    .\Remove-ExcessFileVersions.ps1 -SiteUrl https://contoso.sharepoint.com/sites/media -ClientId 00000000-0000-0000-0000-000000000000 -Library Documents -KeepVersions 5

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in; you need Manage Lists / Full
               Control on the library.
    Warning  : Legal hold, retention labels and eDiscovery may block or be
               violated by version deletion. Check compliance policy before
               running this against real content.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [Parameter(Mandatory = $true)]
    [string]$Library,

    [ValidateRange(1, 1000)]
    [int]$KeepVersions = 10,

    [ValidateRange(0, 100000)]
    [int]$MinFileSizeMB = 5,

    [ValidateRange(1, 100000)]
    [int]$MaxFilesToProcess = 100
)

$ErrorActionPreference = 'Stop'
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
  </ViewFields>
  <RowLimit Paged="TRUE">500</RowLimit>
</View>
"@

Write-Host '*** Version deletion is PERMANENT - trimmed versions do not go to the recycle bin. ***' -ForegroundColor Red
Write-Host ("Site: {0} | Library: {1} | Keeping newest {2} version(s) per file" -f $SiteUrl, $Library, $KeepVersions) -ForegroundColor Cyan

Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

$list = Get-PnPList -Identity $Library -Includes BaseType, EnableVersioning
if (-not $list)                                  { throw "Library '$Library' not found on $SiteUrl." }
if ($list.BaseType -ne 'DocumentLibrary')        { throw "'$Library' is not a document library." }
if (-not $list.EnableVersioning)                 { Write-Host 'Versioning is off on this library - nothing to trim.' -ForegroundColor Green; return }

$items = @(Get-PnPListItem -List $list -Query $caml -PageSize 500)
Write-Host ("{0} file(s) at or above {1} MB." -f $items.Count, $MinFileSizeMB) -ForegroundColor Cyan

$processed    = 0
$deleted      = 0
$freedBytes   = [int64]0
$skippedReads = 0

foreach ($item in $items) {
    if ($processed -ge $MaxFilesToProcess) {
        Write-Host ("Stopping at -MaxFilesToProcess ({0}). Re-run to continue." -f $MaxFilesToProcess) -ForegroundColor Yellow
        break
    }

    $name = [string]$item['FileLeafRef']

    # STRICT read: if we cannot read the history, we do not touch the file.
    $versions = $null
    try {
        $file = $item.File
        $versions = Get-PnPProperty -ClientObject $file -Property Versions
    }
    catch {
        Write-Warning ("SKIPPED {0} - version history could not be read: {1}" -f $name, $_.Exception.Message)
        $skippedReads++
        continue
    }

    if ($null -eq $versions) {
        Write-Warning ("SKIPPED {0} - version history returned nothing (not the same as 'no versions')." -f $name)
        $skippedReads++
        continue
    }

    $processed++
    if ($versions.Count -le $KeepVersions) { continue }

    # Versions come back oldest first; drop everything above the keep count.
    $sorted    = @($versions | Sort-Object Created)
    $toRemove  = @($sorted | Select-Object -First ($sorted.Count - $KeepVersions))
    $bytes     = [int64]0
    foreach ($v in $toRemove) { $bytes += [int64]$v.Size }

    $target = ("{0} ({1} of {2} versions, {3} MB)" -f $name, $toRemove.Count, $versions.Count, [math]::Round($bytes / 1MB, 2))

    if ($PSCmdlet.ShouldProcess($target, 'Delete old file versions')) {
        foreach ($v in $toRemove) {
            $v.DeleteObject()
        }
        Invoke-PnPQuery
        $deleted    += $toRemove.Count
        $freedBytes += $bytes
        Write-Host ("  trimmed {0}" -f $target) -ForegroundColor Green
    }
    else {
        Write-Host ("  would trim {0}" -f $target) -ForegroundColor Yellow
    }
}

Write-Host ''
Write-Host ("Files examined : {0}" -f $processed) -ForegroundColor Cyan
Write-Host ("Files skipped  : {0} (unreadable version history)" -f $skippedReads) -ForegroundColor Cyan
Write-Host ("Versions removed: {0}" -f $deleted) -ForegroundColor Cyan
Write-Host ("Storage freed  : {0} MB" -f [math]::Round($freedBytes / 1MB, 1)) -ForegroundColor Cyan

if ($skippedReads -gt 0) {
    Write-Warning 'Some files were skipped because their history could not be read. Re-run later; do not assume they were clean.'
}

try { Disconnect-PnPOnline } catch { }
