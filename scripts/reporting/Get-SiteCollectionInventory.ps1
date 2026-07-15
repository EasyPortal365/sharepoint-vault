<#
.SYNOPSIS
    Exports an inventory of all SharePoint Online site collections to a CSV file.

.DESCRIPTION
    Connects to the SharePoint Online admin center using the official
    SharePoint Online Management Shell and exports one row per site collection:
    URL, title, template, storage used and quota, owner, sharing capability,
    lock state and last content modified date.

    READ-ONLY: this script makes no changes to the tenant.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER OutputPath
    Path of the CSV file to create. Defaults to a timestamped file in the
    current directory.

.PARAMETER IncludeOneDrive
    Include OneDrive personal sites in the inventory. Off by default.

.EXAMPLE
    .\Get-SiteCollectionInventory.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com

.EXAMPLE
    .\Get-SiteCollectionInventory.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -IncludeOneDrive -OutputPath .\full-inventory.csv

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Interactive sign-in via Connect-SPOService (MFA supported);
               the account needs the SharePoint Administrator role.
               No app registration required.
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules Microsoft.Online.SharePoint.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [string]$OutputPath = ".\SiteCollectionInventory_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [switch]$IncludeOneDrive
)

$ErrorActionPreference = 'Stop'

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

Write-Host 'Retrieving site collections (this can take a while on large tenants) ...' -ForegroundColor Cyan
$sites = @(Get-SPOSite -Limit All -IncludePersonalSite ([bool]$IncludeOneDrive) |
    Where-Object { $_.Template -notlike 'REDIRECT*' })

$inventory = $sites | Sort-Object Url | Select-Object -Property @(
    'Url'
    'Title'
    'Template'
    @{ Name = 'StorageUsedMB';  Expression = { $_.StorageUsageCurrent } }
    @{ Name = 'StorageQuotaMB'; Expression = { $_.StorageQuota } }
    'Owner'
    'SharingCapability'
    'LockState'
    'LastContentModifiedDate'
)

$inventory | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host ''
Write-Host ("Done. {0} site collections exported to {1}" -f $sites.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

$totalGB = [math]::Round(($sites | Measure-Object StorageUsageCurrent -Sum).Sum / 1024, 1)
Write-Host ("Total storage in scope: {0} GB" -f $totalGB) -ForegroundColor Green

Disconnect-SPOService
