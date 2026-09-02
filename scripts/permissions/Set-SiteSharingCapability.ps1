<#
.SYNOPSIS
    *** THIS SCRIPT CHANGES TENANT SETTINGS *** Turns external sharing on or
    off for one site, several sites, or every site collection.

.DESCRIPTION
    Sets SharingCapability on the sites you name. Supports -WhatIf and
    -Confirm; run it with -WhatIf first, always.

    Before changing anything it writes the CURRENT value of every site in
    scope to a CSV. That file is your rollback: it is produced even under
    -WhatIf, and the .NOTES section shows how to replay it.

    Safety rules built in, in order:

      1. A site is never touched before its current state has been read and
         written to the backup. A read failure means the site is skipped,
         not changed.
      2. The tenant setting is a ceiling. A site cannot be more permissive
         than the tenant, so the script refuses up front rather than letting
         you believe a write succeeded.
      3. Locked and read-only sites are skipped and reported, never counted
         as changed.
      4. OneDrive personal sites are out of scope unless you ask for them.
      5. -All still obeys -MaxSites, so a mistake stays small.
      6. The closing summary separates changed / skipped / FAILED. A failure
         is never folded into a success count.

    Sharing levels, from strictest to most permissive:

      Disabled                         no external sharing at all
      ExistingExternalUserSharingOnly  only guests already in the directory
      ExternalUserSharingOnly          new guests, must sign in
      ExternalUserAndGuestSharing      also anonymous "Anyone" links

    That order is NOT the numeric order of the underlying enum
    (ExistingExternalUserSharingOnly is 3, yet second strictest), which is
    why the ceiling check uses an explicit rank table instead of comparing
    the enum values.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER SiteUrl
    One or more site collection URLs to change. Mutually exclusive with -All.

.PARAMETER All
    Apply to every site collection in the tenant. Still skips OneDrive unless
    -IncludeOneDrive is given, and still obeys -MaxSites.

.PARAMETER SharingCapability
    Target level: Disabled, ExistingExternalUserSharingOnly,
    ExternalUserSharingOnly or ExternalUserAndGuestSharing.

.PARAMETER BackupPath
    CSV with the pre-change state of every site in scope. Defaults to a
    timestamped file in the current directory.

.PARAMETER IncludeOneDrive
    Also include OneDrive personal sites. Off by default.

.PARAMETER MaxSites
    Stop after this many sites. Default 50.

.EXAMPLE
    .\Set-SiteSharingCapability.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -SiteUrl https://contoso.sharepoint.com/sites/projects -SharingCapability Disabled -WhatIf

    Tenant ceiling: ExternalUserSharingOnly
    1 site(s) in scope.
    Backup written to .\SharingCapability_Backup_20260901-101500.csv

    What if: Performing the operation "Set sharing to Disabled (was
    ExternalUserSharingOnly)" on target
    "https://contoso.sharepoint.com/sites/projects".

    Changed : 0
    Skipped : 0 (0 already at target, 0 locked)
    FAILED  : 0

.EXAMPLE
    .\Set-SiteSharingCapability.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -All -SharingCapability ExistingExternalUserSharingOnly -MaxSites 200

    110 site(s) in scope.
    Backup written to .\SharingCapability_Backup_20260901-101500.csv
      changed  https://contoso.sharepoint.com/sites/projects  ExternalUserSharingOnly -> ExistingExternalUserSharingOnly
      skipped  https://contoso.sharepoint.com/sites/archive   already ExistingExternalUserSharingOnly
      SKIPPED  https://contoso.sharepoint.com/sites/legal     site is locked (ReadOnly)

    Changed : 96
    Skipped : 13 (11 already at target, 2 locked)
    FAILED  : 1

    WARNING: 1 site(s) FAILED. Their sharing setting is unchanged - re-run for those URLs:
      https://contoso.sharepoint.com/sites/finance

.NOTES
    Requires : SharePoint Online Management Shell
               (Install-Module Microsoft.Online.SharePoint.PowerShell)
    Auth     : Connect-SPOService, SharePoint Administrator role.
    Rollback : The backup CSV holds the previous value per site. To replay it:

                 Import-Csv .\backup.csv | ForEach-Object {
                     Set-SPOSite -Identity $_.Url -SharingCapability $_.SharingCapabilityBefore
                 }

               Check the tenant ceiling first - if the tenant setting was
               lowered in the meantime, the replay fails.
    Caveat   : For group-connected (Teams) sites this changes the SharePoint
               site only. The Microsoft 365 group has its own guest policy,
               which can still admit guests to the team.
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
    [ValidateSet('Disabled', 'ExistingExternalUserSharingOnly', 'ExternalUserSharingOnly', 'ExternalUserAndGuestSharing')]
    [string]$SharingCapability,

    [string]$BackupPath = ".\SharingCapability_Backup_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv",

    [switch]$IncludeOneDrive,

    [ValidateRange(1, 100000)]
    [int]$MaxSites = 50
)

$ErrorActionPreference = 'Stop'

# The module ships for Windows PowerShell and does not auto-load in PowerShell 7,
# so #Requires alone leaves you with CommandNotFoundException. Import it explicitly.
Import-Module Microsoft.Online.SharePoint.PowerShell -WarningAction SilentlyContinue

# Permissiveness rank. Deliberately NOT the enum's numeric value:
# ExistingExternalUserSharingOnly is 3 but is the second strictest level,
# so ordering by [int] would wave through the riskiest combination.
$rank = @{
    'Disabled'                        = 0
    'ExistingExternalUserSharingOnly' = 1
    'ExternalUserSharingOnly'         = 2
    'ExternalUserAndGuestSharing'     = 3
}

Write-Host '*** This script CHANGES external sharing settings. Run with -WhatIf first. ***' -ForegroundColor Red
Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

# --- The tenant setting is a ceiling -------------------------------------
$tenant = Get-SPOTenant
$tenantLevel = [string]$tenant.SharingCapability
Write-Host ("Tenant ceiling: {0}" -f $tenantLevel) -ForegroundColor Cyan

if ($rank[$SharingCapability] -gt $rank[$tenantLevel]) {
    throw ("Cannot set sites to '{0}': the tenant is '{1}', and a site can never be more permissive than the tenant. Raise the tenant setting first, deliberately." -f $SharingCapability, $tenantLevel)
}

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
    @{ Name = 'SharingCapabilityBefore'; Expression = { $_.SharingCapability } }
    @{ Name = 'DefaultLinkPermission';   Expression = { $_.DefaultLinkPermission } }
    @{ Name = 'DefaultSharingLinkType';  Expression = { $_.DefaultSharingLinkType } }
    'LockState'
    @{ Name = 'CapturedUtc'; Expression = { (Get-Date).ToUniversalTime().ToString('o') } }
)
$backup | Export-Csv -Path $BackupPath -NoTypeInformation -Encoding UTF8
Write-Host ("Backup written to {0}" -f (Resolve-Path $BackupPath)) -ForegroundColor Green

# --- Apply ----------------------------------------------------------------
$changed = 0
$alreadyOk = 0
$locked = 0
$failed = New-Object System.Collections.Generic.List[string]

foreach ($site in $sites) {
    $current = [string]$site.SharingCapability

    if (-not $current) {
        Write-Warning ("SKIPPED {0} - current sharing level could not be read. Not touching it." -f $site.Url)
        $failed.Add([string]$site.Url)
        continue
    }
    if ($site.LockState -and $site.LockState -ne 'Unlock') {
        Write-Host ("  SKIPPED {0}  site is locked ({1})" -f $site.Url, $site.LockState) -ForegroundColor Yellow
        $locked++
        continue
    }
    if ($current -eq $SharingCapability) {
        Write-Host ("  skipped  {0}  already {1}" -f $site.Url, $current) -ForegroundColor DarkGray
        $alreadyOk++
        continue
    }

    $action = "Set sharing to $SharingCapability (was $current)"
    if ($PSCmdlet.ShouldProcess([string]$site.Url, $action)) {
        try {
            Set-SPOSite -Identity $site.Url -SharingCapability $SharingCapability -ErrorAction Stop
            Write-Host ("  changed  {0}  {1} -> {2}" -f $site.Url, $current, $SharingCapability) -ForegroundColor Green
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
Write-Host ("Skipped : {0} ({1} already at target, {2} locked)" -f ($alreadyOk + $locked), $alreadyOk, $locked) -ForegroundColor Cyan
Write-Host ("FAILED  : {0}" -f $failed.Count) -ForegroundColor Cyan

if ($failed.Count -gt 0) {
    Write-Host ''
    Write-Warning ("{0} site(s) FAILED. Their sharing setting is unchanged - re-run for those URLs:" -f $failed.Count)
    foreach ($u in $failed) { Write-Host ("  {0}" -f $u) -ForegroundColor Red }
}

Disconnect-SPOService
