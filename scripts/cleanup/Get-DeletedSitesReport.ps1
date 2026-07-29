<#
.SYNOPSIS
    Lists deleted site collections still in the tenant recycle bin, with the
    days left before they are gone for good.

.DESCRIPTION
    A deleted site collection stays restorable for 93 days and keeps
    consuming tenant storage the whole time. Two things regularly surprise
    people:

      * Storage does not come back the moment somebody deletes a site. If
        you are chasing a quota problem, deleted sites are part of the sum.
      * A group-connected site deleted through the Microsoft 365 group has a
        30-day group retention window, which is shorter than the 93-day
        SharePoint one. Once the group is purged, restoring the site is no
        longer a self-service operation.

    This script gives you the countdown per site so restore-or-lose
    decisions get made while they still can be.

    READ-ONLY: nothing is restored and nothing is purged.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER ExpiringWithinDays
    Highlight sites whose restore window closes within this many days.
    Default 14.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-DeletedSitesReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com

.EXAMPLE
    .\Get-DeletedSitesReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -ExpiringWithinDays 30

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Connect-SPOService, SharePoint Administrator role.
    Restore  : Restore-SPODeletedSite -Identity <url>  (run it yourself,
               after checking the URL is not already taken by a new site).
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules Microsoft.Online.SharePoint.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [ValidateRange(1, 93)]
    [int]$ExpiringWithinDays = 14,

    [string]$OutputPath = ".\DeletedSites_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'

# The module ships for Windows PowerShell and does not auto-load in PowerShell 7,
# so #Requires alone leaves you with CommandNotFoundException. Import it explicitly.
Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue
$retentionDays = 93

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

Write-Host 'Retrieving deleted site collections ...' -ForegroundColor Cyan
$deleted = @(Get-SPODeletedSite -Limit All)

if ($deleted.Count -eq 0) {
    Write-Host 'The tenant recycle bin is empty.' -ForegroundColor Green
    Disconnect-SPOService
    return
}

$report = $deleted | Select-Object -Property @(
    'Url'
    @{ Name = 'DeletedOn';      Expression = { $_.DeletionTime } }
    @{ Name = 'DaysSince';      Expression = { [int]((Get-Date) - $_.DeletionTime).TotalDays } }
    @{ Name = 'DaysRemaining';  Expression = { [math]::Max(0, $retentionDays - [int]((Get-Date) - $_.DeletionTime).TotalDays) } }
    @{ Name = 'StorageQuotaMB'; Expression = { $_.StorageQuota } }
    'SiteId'
    'Status'
) | Sort-Object DaysRemaining

$report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host ''
Write-Host ("Done. {0} deleted site(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

$urgent = @($report | Where-Object { $_.DaysRemaining -le $ExpiringWithinDays })
if ($urgent.Count -gt 0) {
    Write-Host ''
    Write-Host ("{0} site(s) leave the recycle bin within {1} days:" -f $urgent.Count, $ExpiringWithinDays) -ForegroundColor Yellow
    $urgent | Format-Table Url, DeletedOn, DaysRemaining -AutoSize
    Write-Host 'Restore with: Restore-SPODeletedSite -Identity <url>' -ForegroundColor Cyan
}

Disconnect-SPOService
