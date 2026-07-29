<#
.SYNOPSIS
    Finds files whose URL or name is close to (or past) SharePoint's length
    limits - the ones that break OneDrive sync, Explorer view and downloads.

.DESCRIPTION
    SharePoint Online allows roughly 400 characters for the full decoded
    path of a file and 255 characters for a single file or folder name.
    Files that sit near the limit work fine in the browser and then fail in
    every other client: sync refuses them, "Open in Explorer" truncates,
    and Download as ZIP silently skips them.

    The report also flags the characters that survive in SharePoint but
    break sync clients and downstream tools: leading/trailing spaces, a
    trailing dot, and the ~ # % & * : < > ? / \ { | } set.

    READ-ONLY: this script renames nothing.

    Deep-scan note: the CAML query walks folders recursively, so the path
    length is measured on the real, current path - not on a search index
    that may be days old and may have missed the freshly created deep
    folder somebody just made.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell cannot reach library content.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER WarnAtPathLength
    Report files whose full URL reaches this length. Default 300
    (the hard limit is about 400 - this gives you room to act).

.PARAMETER WarnAtNameLength
    Report files whose name reaches this length. Default 200 (limit 255).

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-LongFileUrlReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-LongFileUrlReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/archive -ClientId 00000000-0000-0000-0000-000000000000 -WarnAtPathLength 250

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

    [ValidateRange(50, 400)]
    [int]$WarnAtPathLength = 300,

    [ValidateRange(20, 255)]
    [int]$WarnAtNameLength = 200,

    [string]$OutputPath = ".\LongFileUrls_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

$caml = @'
<View Scope="RecursiveAll">
  <Query></Query>
  <ViewFields>
    <FieldRef Name="FileLeafRef" />
    <FieldRef Name="FileRef" />
    <FieldRef Name="Modified" />
    <FieldRef Name="Editor" />
  </ViewFields>
  <RowLimit Paged="TRUE">2000</RowLimit>
</View>
'@

# Characters SharePoint tolerates but sync clients and shells do not.
$troublePattern = '[~#%&*:<>?/\\{|}"]'

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId
        $web = Get-PnPWeb -Includes Url
        $host_ = ([uri]$web.Url).GetLeftPart([System.UriPartial]::Authority)

        $libraries = @(Get-PnPList -Includes Hidden, BaseType, ItemCount |
            Where-Object { -not $_.Hidden -and $_.BaseType -eq 'DocumentLibrary' })

        foreach ($lib in $libraries) {
            if ($lib.ItemCount -eq 0) { continue }
            Write-Host ("  {0} ({1:N0} items) ..." -f $lib.Title, $lib.ItemCount)

            $items = @(Get-PnPListItem -List $lib -Query $caml -PageSize 2000)

            foreach ($item in $items) {
                $name    = [string]$item['FileLeafRef']
                $fileRef = [string]$item['FileRef']
                if (-not $fileRef) { continue }

                $fullUrl = $host_ + $fileRef
                $badChars = [regex]::Matches($name, $troublePattern) | ForEach-Object { $_.Value }
                $edgeIssue = ($name -ne $name.Trim()) -or $name.EndsWith('.')

                $tooLong = ($fullUrl.Length -ge $WarnAtPathLength) -or ($name.Length -ge $WarnAtNameLength)
                if (-not $tooLong -and -not $badChars -and -not $edgeIssue) { continue }

                $report.Add([pscustomobject]@{
                    SiteUrl        = $url
                    Library        = $lib.Title
                    FileName       = $name
                    NameLength     = $name.Length
                    FullUrl        = $fullUrl
                    UrlLength      = $fullUrl.Length
                    PastHardLimit  = ($fullUrl.Length -ge 400)
                    ProblemChars   = (($badChars | Select-Object -Unique) -join ' ')
                    LeadingTrailing = $edgeIssue
                    Modified       = $item['Modified']
                })
            }
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Sort-Object UrlLength -Descending | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} problem file(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

    $critical = @($report | Where-Object { $_.PastHardLimit })
    if ($critical.Count -gt 0) {
        Write-Host ("{0} file(s) are past the ~400 character limit - those already fail to sync." -f $critical.Count) -ForegroundColor Red
    }

    Write-Host ''
    Write-Host 'Ten longest:' -ForegroundColor Cyan
    $report | Sort-Object UrlLength -Descending | Select-Object -First 10 |
        Format-Table UrlLength, NameLength, FileName -AutoSize
}
else {
    Write-Host 'Done. No file is near the length limits.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
