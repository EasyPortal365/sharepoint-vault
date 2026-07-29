<#
.SYNOPSIS
    Maps the hub site topology of a tenant: every hub, its associated sites,
    and the sites that belong to no hub at all.

.DESCRIPTION
    Hub associations drive navigation, search scope, theme inheritance and
    (increasingly) governance policy, but the admin center only shows them
    one hub at a time. This script produces the whole picture as one CSV
    plus an indented tree on the console.

    READ-ONLY: this script makes no changes to the tenant.

    Reliability note: Get-SPOSite -Limit All does not populate HubSiteId on
    every tenant build. The script therefore checks its own output: if hubs
    exist but every site reports an empty HubSiteId, it says so and re-reads
    the affected sites individually instead of quietly reporting "no
    associations". A report that cannot tell "none" from "did not load" is
    worse than no report.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.PARAMETER IncludeUnassociated
    Also list sites that belong to no hub. On by default; use
    -IncludeUnassociated:$false for a hub-only report.

.EXAMPLE
    .\Get-HubSiteStructure.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com

    3 hub site(s) registered.
    Retrieving site collections ...

    [hub] Departments  (https://contoso.sharepoint.com/sites/departments)
           |- Finance  (https://contoso.sharepoint.com/sites/finance)
           |- Human Resources  (https://contoso.sharepoint.com/sites/hr)
    [hub] Projects  (https://contoso.sharepoint.com/sites/projects-hub)
           |- (no associated sites)

    Done. 110 row(s) written to .\HubSiteStructure_20260729-143912.csv
    3 hub(s), 24 associated site(s), 83 standalone site(s).

    A tenant with no hubs stops early rather than writing an empty CSV:
    0 hub site(s) registered.
    No hub sites in this tenant - nothing to map.

.EXAMPLE
    .\Get-HubSiteStructure.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -IncludeUnassociated:$false

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Connect-SPOService, SharePoint Administrator role.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules Microsoft.Online.SharePoint.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [string]$OutputPath = ".\HubSiteStructure_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [bool]$IncludeUnassociated = $true
)

$ErrorActionPreference = 'Stop'

# The module ships for Windows PowerShell and does not auto-load in PowerShell 7,
# so #Requires alone leaves you with CommandNotFoundException. Import it explicitly.
Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue
$empty = [guid]::Empty

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

$hubs = @(Get-SPOHubSite)
Write-Host ("{0} hub site(s) registered." -f $hubs.Count) -ForegroundColor Cyan

if ($hubs.Count -eq 0) {
    Write-Host 'No hub sites in this tenant - nothing to map.' -ForegroundColor Green
    Disconnect-SPOService
    return
}

Write-Host 'Retrieving site collections ...' -ForegroundColor Cyan
$sites = @(Get-SPOSite -Limit All | Where-Object { $_.Template -notlike 'REDIRECT*' })

$associated = @($sites | Where-Object { $_.HubSiteId -and $_.HubSiteId -ne $empty })
if ($associated.Count -eq 0) {
    Write-Warning "Hubs exist but no site reports a HubSiteId. The bulk enumeration did not return the property on this tenant - re-reading each site individually (slower)."
    $sites = @($sites | ForEach-Object { Get-SPOSite -Identity $_.Url })
}

$hubById = @{}
foreach ($h in $hubs) { $hubById[[string]$h.ID] = $h }

$report = New-Object System.Collections.Generic.List[object]

foreach ($site in ($sites | Sort-Object Url)) {
    $hubId = [string]$site.HubSiteId
    $isHub = $hubById.ContainsKey($hubId) -and ($hubById[$hubId].SiteUrl -eq $site.Url)

    $hubTitle = ''
    $hubUrl   = ''
    if ($hubId -and $hubId -ne [string]$empty -and $hubById.ContainsKey($hubId)) {
        $hubTitle = $hubById[$hubId].Title
        $hubUrl   = $hubById[$hubId].SiteUrl
    }

    if (-not $hubUrl -and -not $IncludeUnassociated) { continue }

    $report.Add([pscustomobject]@{
        SiteUrl       = $site.Url
        SiteTitle     = $site.Title
        Template      = $site.Template
        Role          = if ($isHub) { 'Hub' } elseif ($hubUrl) { 'Associated' } else { 'Standalone' }
        HubTitle      = $hubTitle
        HubUrl        = $hubUrl
        StorageUsedMB = $site.StorageUsageCurrent
        LastModified  = $site.LastContentModifiedDate
    })
}

$report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host ''
foreach ($hub in ($hubs | Sort-Object Title)) {
    $children = @($report | Where-Object { $_.HubUrl -eq $hub.SiteUrl -and $_.Role -eq 'Associated' })
    Write-Host ("[hub] {0}  ({1})" -f $hub.Title, $hub.SiteUrl) -ForegroundColor Cyan
    foreach ($c in ($children | Sort-Object SiteTitle)) {
        Write-Host ("       |- {0}  ({1})" -f $c.SiteTitle, $c.SiteUrl)
    }
    if ($children.Count -eq 0) { Write-Host '       |- (no associated sites)' -ForegroundColor DarkGray }
}

$standalone = @($report | Where-Object { $_.Role -eq 'Standalone' })
Write-Host ''
Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
Write-Host ("{0} hub(s), {1} associated site(s), {2} standalone site(s)." -f $hubs.Count, @($report | Where-Object { $_.Role -eq 'Associated' }).Count, $standalone.Count) -ForegroundColor Green

Disconnect-SPOService
