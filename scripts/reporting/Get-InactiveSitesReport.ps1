<#
.SYNOPSIS
    Finds site collections nobody has touched in a long time - the shortlist
    for archival, ownership review or deletion.

.DESCRIPTION
    Ranks every site collection by how long it has been since its content
    last changed, and enriches each row with the numbers you need for the
    "keep or kill" conversation: storage, owner, template, sharing setting
    and whether the site is group-connected.

    READ-ONLY: this script makes no changes to the tenant. Deleting sites is
    deliberately out of scope - use this report as evidence, then act
    through the admin center or a separate, reviewed script.

    Caveat about LastContentModifiedDate: it moves for service-side changes
    too (retention processing, ownership changes, Teams provisioning), so a
    recent date is weak evidence that a human is using the site. Treat it as
    an upper bound on inactivity and confirm with usage reports before
    deleting anything.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER InactiveDays
    Sites untouched for at least this many days are reported. Default 365.

.PARAMETER MinStorageMB
    Only report sites using at least this much storage. Default 0 (all).

.PARAMETER IncludeOneDrive
    Include OneDrive personal sites. Off by default.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-InactiveSitesReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com

.EXAMPLE
    .\Get-InactiveSitesReport.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -InactiveDays 730 -MinStorageMB 1024

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Connect-SPOService, SharePoint Administrator role.
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules Microsoft.Online.SharePoint.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [ValidateRange(1, 100000)]
    [int]$InactiveDays = 365,

    [ValidateRange(0, [int]::MaxValue)]
    [int]$MinStorageMB = 0,

    [switch]$IncludeOneDrive,

    [string]$OutputPath = ".\InactiveSites_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$cutoff = (Get-Date).AddDays(-$InactiveDays)

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

Write-Host 'Retrieving site collections ...' -ForegroundColor Cyan
$sites = @(Get-SPOSite -Limit All -IncludePersonalSite ([bool]$IncludeOneDrive) |
    Where-Object { $_.Template -notlike 'REDIRECT*' })

Write-Host ("{0} site(s) in scope, cutoff {1:yyyy-MM-dd}." -f $sites.Count, $cutoff) -ForegroundColor Cyan

$stale = @($sites | Where-Object {
    $_.LastContentModifiedDate -lt $cutoff -and $_.StorageUsageCurrent -ge $MinStorageMB
})

$report = $stale |
    Sort-Object LastContentModifiedDate |
    Select-Object -Property @(
        'Url'
        'Title'
        'Template'
        @{ Name = 'DaysInactive';   Expression = { [int]((Get-Date) - $_.LastContentModifiedDate).TotalDays } }
        'LastContentModifiedDate'
        @{ Name = 'StorageUsedMB';  Expression = { $_.StorageUsageCurrent } }
        'Owner'
        @{ Name = 'GroupConnected'; Expression = { $_.GroupId -and $_.GroupId -ne [guid]::Empty } }
        'SharingCapability'
        'LockState'
    )

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

    $reclaimGB = [math]::Round((($stale | Measure-Object StorageUsageCurrent -Sum).Sum) / 1024, 1)
    Write-Host ("Done. {0} inactive site(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
    Write-Host ("Storage held by inactive sites: {0} GB" -f $reclaimGB) -ForegroundColor Yellow

    Write-Host ''
    Write-Host 'Ten longest dormant:' -ForegroundColor Cyan
    $report | Select-Object -First 10 | Format-Table Url, DaysInactive, StorageUsedMB, Owner -AutoSize
}
else {
    Write-Host ("Done. No site has been inactive for {0}+ days." -f $InactiveDays) -ForegroundColor Green
}

Disconnect-SPOService
