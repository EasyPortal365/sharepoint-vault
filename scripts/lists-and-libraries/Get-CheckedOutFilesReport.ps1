<#
.SYNOPSIS
    Finds files left checked out - including the ones that were never checked
    in and are therefore invisible to everybody except the person who
    uploaded them.

.DESCRIPTION
    A file checked out to somebody who then went on holiday is a support
    ticket waiting to happen: colleagues cannot edit it, and a file that was
    uploaded but never checked in (a library with Require Check Out on) is
    not merely locked - it does not appear in the library for anyone else at
    all. Search does not index it, workflows skip it, and the uploader has
    long forgotten about it.

    This script queries each library with a CAML filter on CheckoutUser, so
    the work happens server-side and stays fast on large libraries.

    READ-ONLY: nothing is checked in or discarded. Forcing a check-in
    (Set-PnPFileCheckedIn) destroys or publishes somebody's unsaved work, so
    it deliberately stays a human decision.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell cannot reach list content.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER MinDaysCheckedOut
    Only report files checked out for at least this many days. Default 0 (all).

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-CheckedOutFilesReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

    Scanning https://contoso.sharepoint.com/sites/projects ...
      Documents: 3 checked-out file(s)

    Done. 3 row(s) written to .\CheckedOutFiles_20260729-143912.csv
    1 file(s) have no checked-in version - nobody but the uploader can see them.

    CSV columns, and a row:
    SiteUrl,Library,FileName,FilePath,CheckedOutTo,Modified,DaysCheckedOut,Version,NeverCheckedIn
    .../sites/projects,Documents,Tender draft.docx,/sites/projects/Shared
    Documents/Tender draft.docx,Megan Bowen,2026-02-11 16:03:41,168,0.1,True

.EXAMPLE
    .\Get-CheckedOutFilesReport.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000 -MinDaysCheckedOut 30

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site. You need at least
               Manage Lists to see files checked out by other people; a
               plain member sees only their own and the report will look
               deceptively clean.
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

    [ValidateRange(0, 100000)]
    [int]$MinDaysCheckedOut = 0,

    [string]$OutputPath = ".\CheckedOutFiles_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

$caml = @'
<View Scope="RecursiveAll">
  <Query>
    <Where><IsNotNull><FieldRef Name="CheckoutUser" /></IsNotNull></Where>
  </Query>
  <ViewFields>
    <FieldRef Name="FileLeafRef" />
    <FieldRef Name="FileRef" />
    <FieldRef Name="CheckoutUser" />
    <FieldRef Name="Modified" />
    <FieldRef Name="Editor" />
    <FieldRef Name="_UIVersionString" />
  </ViewFields>
  <RowLimit Paged="TRUE">500</RowLimit>
</View>
'@

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $libraries = @(Get-PnPList -Includes Hidden, BaseType, ItemCount |
            Where-Object { -not $_.Hidden -and $_.BaseType -eq 'DocumentLibrary' })

        foreach ($lib in $libraries) {
            if ($lib.ItemCount -eq 0) { continue }

            $items = @()
            try {
                $items = @(Get-PnPListItem -List $lib -Query $caml -PageSize 500)
            }
            catch {
                # A failed read is not "no checked-out files" - say so.
                Write-Warning ("{0} / {1}: read failed - {2}" -f $url, $lib.Title, $_.Exception.Message)
                $report.Add([pscustomobject]@{
                    SiteUrl = $url; Library = $lib.Title; FileName = '(read failed)'
                    FilePath = ''; CheckedOutTo = ''; Modified = ''; DaysCheckedOut = ''
                    Version = ''; NeverCheckedIn = ''
                })
                continue
            }

            foreach ($item in $items) {
                $modified = [datetime]$item['Modified']
                $days = [int]((Get-Date) - $modified).TotalDays
                if ($days -lt $MinDaysCheckedOut) { continue }

                $checkoutUser = ''
                if ($item['CheckoutUser']) { $checkoutUser = $item['CheckoutUser'].LookupValue }

                $version = [string]$item['_UIVersionString']

                $report.Add([pscustomobject]@{
                    SiteUrl        = $url
                    Library        = $lib.Title
                    FileName       = $item['FileLeafRef']
                    FilePath       = $item['FileRef']
                    CheckedOutTo   = $checkoutUser
                    Modified       = $modified
                    DaysCheckedOut = $days
                    Version        = $version
                    # No major version yet -> nobody else has ever seen this file.
                    NeverCheckedIn = ($version -like '0.*' -or $version -eq '')
                })
            }

            $found = @($report | Where-Object { $_.SiteUrl -eq $url -and $_.Library -eq $lib.Title -and $_.FileName -ne '(read failed)' })
            if ($found.Count -gt 0) {
                Write-Host ("  {0}: {1} checked-out file(s)" -f $lib.Title, $found.Count) -ForegroundColor Yellow
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
    Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

    $invisible = @($report | Where-Object { $_.NeverCheckedIn -eq $true })
    if ($invisible.Count -gt 0) {
        Write-Host ("{0} file(s) have no checked-in version - nobody but the uploader can see them." -f $invisible.Count) -ForegroundColor Red
    }
}
else {
    Write-Host 'Done. No checked-out files found.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
