<#
.SYNOPSIS
    Reports the site collection administrators of every site in the tenant.

.DESCRIPTION
    Site collection administrators bypass every permission on the site,
    including item-level breaks, and they do not appear in the Owners group.
    That combination makes them the most under-audited privilege in
    SharePoint Online: the group-connected sites hand SCA rights to every
    Microsoft 365 group owner automatically, and nobody ever takes them away.

    This script lists, per site: the primary owner from the admin center and
    every user flagged IsSiteAdmin on the site itself, and flags sites whose
    admin count is unusually high or whose admins include a guest account.

    READ-ONLY: this script makes no changes to the tenant.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER SiteUrl
    Limit the report to specific sites. Omit to scan every site collection.

.PARAMETER WarnAboveCount
    Flag sites with more than this many site collection admins. Default 3.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-SiteCollectionAdminReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com

.EXAMPLE
    .\Get-SiteCollectionAdminReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -SiteUrl https://contoso.sharepoint.com/sites/finance

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Connect-SPOService, SharePoint Administrator role.
    Speed    : One Get-SPOUser call per site. On a 2,000-site tenant expect
               tens of minutes - narrow it with -SiteUrl when you can.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules Microsoft.Online.SharePoint.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [string[]]$SiteUrl,

    [ValidateRange(1, 100)]
    [int]$WarnAboveCount = 3,

    [string]$OutputPath = ".\SiteCollectionAdmins_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'

# The module ships for Windows PowerShell and does not auto-load in PowerShell 7,
# so #Requires alone leaves you with CommandNotFoundException. Import it explicitly.
Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue
$report = New-Object System.Collections.Generic.List[object]

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

if ($SiteUrl) {
    $sites = @($SiteUrl | ForEach-Object { Get-SPOSite -Identity $_ })
}
else {
    Write-Host 'Retrieving site collections ...' -ForegroundColor Cyan
    $sites = @(Get-SPOSite -Limit All | Where-Object { $_.Template -notlike 'REDIRECT*' })
}

$i = 0
foreach ($site in $sites) {
    $i++
    Write-Progress -Activity 'Reading site collection administrators' -Status $site.Url -PercentComplete (($i / $sites.Count) * 100)

    try {
        $admins = @(Get-SPOUser -Site $site.Url -Limit All | Where-Object { $_.IsSiteAdmin })

        foreach ($admin in $admins) {
            $report.Add([pscustomobject]@{
                SiteUrl     = $site.Url
                SiteTitle   = $site.Title
                Template    = $site.Template
                AdminName   = $admin.DisplayName
                AdminLogin  = $admin.LoginName
                IsGroup     = $admin.IsGroup
                IsGuest     = ($admin.LoginName -like '*#EXT#*')
                AdminCount  = $admins.Count
                TooMany     = ($admins.Count -gt $WarnAboveCount)
                PrimaryOwner = $site.Owner
            })
        }

        if ($admins.Count -eq 0) {
            # Genuinely possible on some templates - report it rather than dropping the site.
            $report.Add([pscustomobject]@{
                SiteUrl      = $site.Url
                SiteTitle    = $site.Title
                Template     = $site.Template
                AdminName    = '(none returned)'
                AdminLogin   = ''
                IsGroup      = ''
                IsGuest      = ''
                AdminCount   = 0
                TooMany      = $false
                PrimaryOwner = $site.Owner
            })
        }
    }
    catch {
        Write-Warning "$($site.Url): $($_.Exception.Message)"
        $report.Add([pscustomobject]@{
            SiteUrl      = $site.Url
            SiteTitle    = $site.Title
            Template     = $site.Template
            AdminName    = '(read failed)'
            AdminLogin   = $_.Exception.Message
            IsGroup      = ''
            IsGuest      = ''
            AdminCount   = -1
            TooMany      = $false
            PrimaryOwner = $site.Owner
        })
    }
}
Write-Progress -Activity 'Reading site collection administrators' -Completed

$report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host ''
Write-Host ("Done. {0} row(s) across {1} site(s) written to {2}" -f $report.Count, $sites.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

$guests = @($report | Where-Object { $_.IsGuest -eq $true })
if ($guests.Count -gt 0) {
    Write-Host ("  {0} site collection admin(s) are EXTERNAL accounts." -f $guests.Count) -ForegroundColor Red
}

$crowded = @($report | Where-Object { $_.TooMany } | Select-Object -ExpandProperty SiteUrl -Unique)
if ($crowded.Count -gt 0) {
    Write-Host ("  {0} site(s) have more than {1} administrators." -f $crowded.Count, $WarnAboveCount) -ForegroundColor Yellow
}

Disconnect-SPOService
