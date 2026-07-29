<#
.SYNOPSIS
    Reports the external sharing posture of a tenant: sharing capability per
    site collection, plus every external (guest) user SharePoint knows about.

.DESCRIPTION
    Produces two CSV files:

      1. Sites    - URL, sharing capability, default link type, expiry policy
                    and whether the site overrides the tenant setting.
      2. Guests   - external users, when they were accepted and by whom.

    READ-ONLY: this script makes no changes to the tenant.

    Paging note: Get-SPOExternalUser caps -PageSize at 50 and pages through
    -Position, so a tenant with 900 guests needs 18 round trips. The tenant
    scope of the cmdlet is also known to stop producing results well before
    the real guest count on some tenants - if the number comes back
    suspiciously round (500, 1000), re-run per site with -SiteUrl and treat
    the tenant-wide number as a floor, not a total.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER OutputPath
    CSV file for the per-site sharing report. Defaults to a timestamped file
    in the current directory.

.PARAMETER GuestOutputPath
    CSV file for the external user list. Defaults to a timestamped file in
    the current directory.

.PARAMETER SkipGuests
    Only report site sharing settings and skip the (slow) guest enumeration.

.EXAMPLE
    .\Get-ExternalSharingReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com

.EXAMPLE
    .\Get-ExternalSharingReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -SkipGuests

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

    [string]$OutputPath = ".\ExternalSharing_Sites_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [string]$GuestOutputPath = ".\ExternalSharing_Guests_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [switch]$SkipGuests
)

$ErrorActionPreference = 'Stop'

# The module ships for Windows PowerShell and does not auto-load in PowerShell 7,
# so #Requires alone leaves you with CommandNotFoundException. Import it explicitly.
Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

$tenant = Get-SPOTenant
Write-Host ("Tenant sharing capability: {0}" -f $tenant.SharingCapability) -ForegroundColor Cyan

Write-Host 'Retrieving site collections ...' -ForegroundColor Cyan
$sites = @(Get-SPOSite -Limit All | Where-Object { $_.Template -notlike 'REDIRECT*' })

$siteReport = $sites | Sort-Object Url | Select-Object -Property @(
    'Url'
    'Title'
    'SharingCapability'
    'DefaultSharingLinkType'
    'DefaultLinkPermission'
    @{ Name = 'AnonymousLinkExpiryDays'; Expression = { $_.AnonymousLinkExpirationInDays } }
    @{ Name = 'OverridesTenantExpiry';   Expression = { $_.OverrideTenantAnonymousLinkExpirationPolicy } }
    @{ Name = 'DiffersFromTenant';       Expression = { $_.SharingCapability -ne $tenant.SharingCapability } }
    'SharingDomainRestrictionMode'
    'LockState'
)

$siteReport | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
Write-Host ("  {0} site(s) written to {1}" -f $sites.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

$open = @($sites | Where-Object { $_.SharingCapability -eq 'ExternalUserAndGuestSharing' })
if ($open.Count -gt 0) {
    Write-Host ("  {0} site(s) allow anonymous ('Anyone') links." -f $open.Count) -ForegroundColor Yellow
}

if (-not $SkipGuests) {
    Write-Host 'Enumerating external users (50 per page) ...' -ForegroundColor Cyan

    $guests   = New-Object System.Collections.Generic.List[object]
    $position = 0
    $pageSize = 50

    while ($true) {
        $page = @(Get-SPOExternalUser -Position $position -PageSize $pageSize -SortOrder Ascending)
        if ($page.Count -eq 0) { break }

        foreach ($g in $page) {
            $guests.Add([pscustomobject]@{
                DisplayName    = $g.DisplayName
                Email          = $g.Email
                AcceptedAs     = $g.AcceptedAs
                InvitedBy      = $g.InvitedBy
                WhenCreated    = $g.WhenCreated
                UniqueId       = $g.UniqueId
            })
        }

        Write-Host ("  {0} guests so far ..." -f $guests.Count)
        $position += $page.Count

        # A short page means we reached the end of what the cmdlet will hand out.
        if ($page.Count -lt $pageSize) { break }
    }

    if ($guests.Count -gt 0) {
        $guests | Export-Csv -Path $GuestOutputPath -NoTypeInformation -Encoding UTF8
        Write-Host ("  {0} external user(s) written to {1}" -f $guests.Count, (Resolve-Path $GuestOutputPath)) -ForegroundColor Green

        if ($guests.Count % 100 -eq 0) {
            Write-Warning "The guest count is a round number - the tenant-scope enumeration may have been cut short. Verify per site with Get-SPOExternalUser -SiteUrl."
        }
    }
    else {
        Write-Host '  No external users returned.' -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Done.' -ForegroundColor Green
Disconnect-SPOService
