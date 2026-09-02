<#
.SYNOPSIS
    *** THIS SCRIPT CHANGES TENANT SETTINGS *** Changes the default sharing
    link permission (Edit / View) on one site, several sites, or every site.

.DESCRIPTION
    When somebody clicks Share, SharePoint pre-selects a permission. On many
    tenants that default is Edit, so the fastest path - Share, type a name,
    Send - hands out write access to a document the sender only meant to
    show. Setting the default to View does not stop anyone granting Edit
    deliberately; it stops Edit being the accident.

    This script sets DefaultLinkPermission. It supports -WhatIf and
    -Confirm; run it with -WhatIf first, always.

    Before changing anything it writes the CURRENT value of every site in
    scope to a CSV, produced even under -WhatIf. That file is your rollback.

    Safety rules built in, in order:

      1. Nothing is touched before its current state has been read and
         backed up. A read failure skips the site rather than changing it.
      2. Sites with sharing switched off are reported and skipped - the
         setting exists there but governs nothing, and changing it would
         produce a reassuring log line about an inert setting.
      3. Locked and read-only sites are skipped and reported.
      4. OneDrive personal sites are out of scope unless asked for.
      5. -All still obeys -MaxSites.
      6. The summary separates changed / skipped / FAILED.

    Related but different, and deliberately not changed here:
    DefaultSharingLinkType decides WHO the pre-selected link is for
    (Direct = specific people, Internal = anyone in the organisation,
    AnonymousAccess = anyone at all). Permission and audience are two
    separate settings, and "Anyone" links carrying Edit is the combination
    worth auditing first.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER SiteUrl
    One or more site collection URLs to change. Mutually exclusive with -All.

.PARAMETER All
    Apply to every site collection in the tenant.

.PARAMETER DefaultLinkPermission
    Target permission: View, Edit, or None (None lets the site fall back to
    the tenant default rather than pinning its own).

.PARAMETER BackupPath
    CSV with the pre-change state. Defaults to a timestamped file in the
    current directory.

.PARAMETER IncludeOneDrive
    Also include OneDrive personal sites. Off by default.

.PARAMETER MaxSites
    Stop after this many sites. Default 50.

.EXAMPLE
    .\Set-SiteDefaultLinkPermission.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -SiteUrl https://contoso.sharepoint.com/sites/projects -DefaultLinkPermission View -WhatIf

    Tenant default link permission: Edit
    1 site(s) in scope.
    Backup written to .\DefaultLinkPermission_Backup_20260901-101500.csv

    What if: Performing the operation "Set default link permission to View
    (was Edit)" on target "https://contoso.sharepoint.com/sites/projects".

    Changed : 0
    Skipped : 0 (0 already at target, 0 sharing disabled, 0 locked)
    FAILED  : 0

.EXAMPLE
    .\Set-SiteDefaultLinkPermission.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -All -DefaultLinkPermission View -MaxSites 200

    110 site(s) in scope.
    Backup written to .\DefaultLinkPermission_Backup_20260901-101500.csv
      changed  https://contoso.sharepoint.com/sites/projects  Edit -> View
      skipped  https://contoso.sharepoint.com/sites/wiki      already View
      SKIPPED  https://contoso.sharepoint.com/sites/archive   sharing is Disabled - setting would have no effect

    Changed : 88
    Skipped : 22 (14 already at target, 6 sharing disabled, 2 locked)
    FAILED  : 0

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Connect-SPOService, SharePoint Administrator role.
    Rollback : The backup CSV holds the previous value per site:

                 Import-Csv .\backup.csv | ForEach-Object {
                     Set-SPOSite -Identity $_.Url -DefaultLinkPermission $_.DefaultLinkPermissionBefore
                 }

    Caveat   : This changes the default only. Existing links keep the
               permission they were created with, so lowering the default
               does not narrow anything already shared - audit those
               separately with Get-SharingLinksReport.ps1.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules Microsoft.Online.SharePoint.PowerShell

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High', DefaultParameterSetName = 'Sites')]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAdminUrl,

    [Parameter(Mandatory = $true, ParameterSetName = 'Sites')]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true, ParameterSetName = 'All')]
    [switch]$All,

    [Parameter(Mandatory = $true)]
    [ValidateSet('View', 'Edit', 'None')]
    [string]$DefaultLinkPermission,

    [string]$BackupPath = ".\DefaultLinkPermission_Backup_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [switch]$IncludeOneDrive,

    [ValidateRange(1, 100000)]
    [int]$MaxSites = 50
)

$ErrorActionPreference = 'Stop'

# The module ships for Windows PowerShell and does not auto-load in PowerShell 7,
# so #Requires alone leaves you with CommandNotFoundException. Import it explicitly.
Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue

Write-Host '*** This script CHANGES sharing defaults. Run with -WhatIf first. ***' -ForegroundColor Red
Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

$tenant = Get-SPOTenant
Write-Host ("Tenant default link permission: {0}" -f $tenant.DefaultLinkPermission) -ForegroundColor Cyan

# --- Resolve scope --------------------------------------------------------
if ($All) {
    Write-Host 'Retrieving site collections ...' -ForegroundColor Cyan
    $sites = @(Get-SPOSite -Limit All -IncludePersonalSite ([bool]$IncludeOneDrive) |
        Where-Object { $_.Template -notlike 'REDIRECT*' })
}
else {
    $sites = @()
    foreach ($u in $SiteUrl) {
        try { $sites += Get-SPOSite -Identity $u }
        catch { Write-Warning ("Cannot read {0}: {1}" -f $u, $_.Exception.Message) }
    }
}

Write-Host ("{0} site(s) in scope." -f $sites.Count) -ForegroundColor Cyan
if ($sites.Count -eq 0) {
    Write-Warning 'Nothing in scope - no site could be read. This is not the same as "nothing to do".'
    Disconnect-SPOService
    return
}
if ($sites.Count -gt $MaxSites) {
    Write-Warning ("Scope holds {0} sites but -MaxSites is {1}. Only the first {1} will be processed." -f $sites.Count, $MaxSites)
    $sites = $sites[0..($MaxSites - 1)]
}

# --- Backup BEFORE any write ---------------------------------------------
$backup = $sites | Select-Object -Property @(
    'Url'
    'Title'
    @{ Name = 'DefaultLinkPermissionBefore'; Expression = { $_.DefaultLinkPermission } }
    @{ Name = 'DefaultSharingLinkType';      Expression = { $_.DefaultSharingLinkType } }
    'SharingCapability'
    'LockState'
    @{ Name = 'CapturedUtc'; Expression = { (Get-Date).ToUniversalTime().ToString('o') } }
)
$backup | Export-Csv -Path $BackupPath -NoTypeInformation -Encoding UTF8
Write-Host ("Backup written to {0}" -f (Resolve-Path $BackupPath)) -ForegroundColor Green

# --- Apply ----------------------------------------------------------------
$changed = 0
$alreadyOk = 0
$sharingOff = 0
$locked = 0
$failed = New-Object System.Collections.Generic.List[string]

foreach ($site in $sites) {
    $current = [string]$site.DefaultLinkPermission
    $capability = [string]$site.SharingCapability

    if (-not $capability) {
        Write-Warning ("SKIPPED {0} - sharing capability could not be read. Not touching it." -f $site.Url)
        $failed.Add([string]$site.Url)
        continue
    }
    if ($site.LockState -and $site.LockState -ne 'Unlock') {
        Write-Host ("  SKIPPED {0}  site is locked ({1})" -f $site.Url, $site.LockState) -ForegroundColor Yellow
        $locked++
        continue
    }
    # The setting exists on a non-sharing site but governs nothing. Writing it
    # would produce a success line that means nothing.
    if ($capability -eq 'Disabled') {
        Write-Host ("  SKIPPED {0}  sharing is Disabled - setting would have no effect" -f $site.Url) -ForegroundColor Yellow
        $sharingOff++
        continue
    }
    if ($current -eq $DefaultLinkPermission) {
        Write-Host ("  skipped  {0}  already {1}" -f $site.Url, $current) -ForegroundColor DarkGray
        $alreadyOk++
        continue
    }

    $shown = if ($current) { $current } else { '(not set)' }
    $action = "Set default link permission to $DefaultLinkPermission (was $shown)"
    if ($PSCmdlet.ShouldProcess([string]$site.Url, $action)) {
        try {
            Set-SPOSite -Identity $site.Url -DefaultLinkPermission $DefaultLinkPermission -ErrorAction Stop
            Write-Host ("  changed  {0}  {1} -> {2}" -f $site.Url, $shown, $DefaultLinkPermission) -ForegroundColor Green
            $changed++
        }
        catch {
            Write-Warning ("FAILED {0}: {1}" -f $site.Url, $_.Exception.Message)
            $failed.Add([string]$site.Url)
        }
    }
}

Write-Host ''
Write-Host ("Changed : {0}" -f $changed) -ForegroundColor Cyan
Write-Host ("Skipped : {0} ({1} already at target, {2} sharing disabled, {3} locked)" -f ($alreadyOk + $sharingOff + $locked), $alreadyOk, $sharingOff, $locked) -ForegroundColor Cyan
Write-Host ("FAILED  : {0}" -f $failed.Count) -ForegroundColor Cyan

if ($failed.Count -gt 0) {
    Write-Host ''
    Write-Warning ("{0} site(s) FAILED. Their default is unchanged - re-run for those URLs:" -f $failed.Count)
    foreach ($u in $failed) { Write-Host ("  {0}" -f $u) -ForegroundColor Red }
}

Disconnect-SPOService
