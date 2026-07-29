<#
.SYNOPSIS
    Lists every sharing link that exists on a site, who is on it, and which
    document it points at.

.DESCRIPTION
    When someone shares a file, SharePoint creates a hidden site group named

        SharingLinks.<document GUID>.<LinkKind>.<link GUID>

    and puts every person who used the link into it. Those groups never show
    up in the "Site permissions" UI, they survive the file being moved, and
    they are the single best answer to "who has this document through a link
    we forgot about?".

    This script enumerates those groups, decodes the name, and optionally
    resolves each document GUID back to a file path.

    READ-ONLY: this script makes no changes.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell cannot read site groups.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER ResolveDocuments
    Resolve each document GUID to a server-relative path via
    /_api/web/GetFileById. One extra request per link; links whose file was
    deleted answer 404 and are reported as "file no longer exists".

.PARAMETER OnlyWithMembers
    Skip links that nobody has used yet (empty groups).

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-SharingLinksReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-SharingLinksReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -ResolveDocuments -OnlyWithMembers

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in; needs Full Control on the site.
    Caveat   : An "Anyone" (anonymous) link has no members to enumerate - the
               group exists but stays empty. Absence of members is NOT
               evidence that nobody used the link.
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [switch]$ResolveDocuments,

    [switch]$OnlyWithMembers,

    [string]$OutputPath = ".\SharingLinks_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

# SharingLinks.<docGuid>.<Kind>.<linkGuid>
$pattern = '^SharingLinks\.(?<doc>[0-9a-fA-F-]{36})\.(?<kind>[^.]+)\.(?<link>[0-9a-fA-F-]{36})$'

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $groups = @(Get-PnPGroup | Where-Object { $_.LoginName -match $pattern })
        Write-Host ("  {0} sharing link group(s) found." -f $groups.Count)

        foreach ($group in $groups) {
            $m = [regex]::Match($group.LoginName, $pattern)
            $docGuid = $m.Groups['doc'].Value
            $kind    = $m.Groups['kind'].Value

            $members = @()
            try { $members = @(Get-PnPGroupMember -Group $group.Id) } catch { }

            if ($OnlyWithMembers -and $members.Count -eq 0) { continue }

            $docPath = ''
            if ($ResolveDocuments) {
                try {
                    $file = Invoke-PnPSPRestMethod -Method Get -Url ("/_api/web/GetFileById(guid'{0}')?`$select=ServerRelativeUrl" -f $docGuid)
                    $docPath = $file.ServerRelativeUrl
                }
                catch {
                    $docPath = 'file no longer exists (or no access)'
                }
            }

            $report.Add([pscustomobject]@{
                SiteUrl      = $url
                LinkKind     = $kind
                DocumentGuid = $docGuid
                DocumentPath = $docPath
                MemberCount  = $members.Count
                Members      = (($members | Select-Object -ExpandProperty Email) -join '; ')
                GroupId      = $group.Id
                GroupLogin   = $group.LoginName
            })
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} sharing link(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

    $external = @($report | Where-Object { $_.LinkKind -like '*Anonymous*' -or $_.LinkKind -like '*Flexible*' })
    if ($external.Count -gt 0) {
        Write-Host ("  {0} link(s) are Anonymous or Flexible (specific-people/anyone) - review those first." -f $external.Count) -ForegroundColor Yellow
    }
}
else {
    Write-Host 'Done. No sharing link groups found.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
