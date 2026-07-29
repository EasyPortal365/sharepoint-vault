<#
.SYNOPSIS
    Captures tenant-level SharePoint settings as a JSON baseline, and diffs a
    later capture against it to show exactly what somebody changed.

.DESCRIPTION
    Get-SPOTenant returns well over a hundred properties, most of which decide
    something a security review cares about: external sharing, anonymous link
    expiry, legacy authentication, sync restrictions, custom script. Nothing
    in Microsoft 365 keeps a readable history of them, so drift is invisible
    until it bites.

    Run the script once to write a baseline. Run it again with -CompareWith
    and it prints, per property, "was X, now Y".

    READ-ONLY: this script only reads tenant settings and writes local files.

    Values are not interpreted as good or bad - the point is that a change is
    visible, not that a machine decides whether it was allowed.

.PARAMETER TenantAdminUrl
    URL of the SharePoint admin center, e.g. https://contoso-admin.sharepoint.com

.PARAMETER OutputPath
    JSON file to write. Defaults to a timestamped file in the current directory.

.PARAMETER CompareWith
    Path to a previous baseline. When given, the script compares the current
    settings against it and reports the differences.

.PARAMETER FailOnDrift
    Exit with code 1 when differences are found. Handy in a scheduled task.

.EXAMPLE
    .\Get-TenantSettingsBaseline.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -OutputPath .\baseline.json

.EXAMPLE
    .\Get-TenantSettingsBaseline.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com -CompareWith .\baseline.json

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

    [string]$OutputPath = ".\TenantBaseline_$(Get-Date -Format 'yyyyMMdd-HHmmss').json",

    [string]$CompareWith,

    [switch]$FailOnDrift
)

$ErrorActionPreference = 'Stop'

Write-Host "Connecting to $TenantAdminUrl ..." -ForegroundColor Cyan
Connect-SPOService -Url $TenantAdminUrl

$tenant = Get-SPOTenant

# Flatten to a name -> string map so the diff never depends on object identity.
$current = [ordered]@{}
foreach ($p in ($tenant.PSObject.Properties | Sort-Object Name)) {
    $value = $p.Value
    if ($null -eq $value)            { $current[$p.Name] = '(null)';            continue }
    if ($value -is [System.Array])   { $current[$p.Name] = ($value -join ', '); continue }
    $current[$p.Name] = [string]$value
}

Write-Host ("Captured {0} tenant properties." -f $current.Count) -ForegroundColor Cyan

$snapshot = [ordered]@{
    CapturedUtc = (Get-Date).ToUniversalTime().ToString('o')
    AdminUrl    = $TenantAdminUrl
    Settings    = $current
}

$snapshot | ConvertTo-Json -Depth 5 | Set-Content -Path $OutputPath -Encoding UTF8
Write-Host ("Baseline written to {0}" -f (Resolve-Path $OutputPath)) -ForegroundColor Green

if (-not $CompareWith) {
    Disconnect-SPOService
    return
}

if (-not (Test-Path $CompareWith)) {
    throw "Baseline file not found: $CompareWith"
}

$previous = Get-Content -Path $CompareWith -Raw | ConvertFrom-Json
if (-not $previous.Settings) {
    throw "$CompareWith does not look like a baseline produced by this script (no 'Settings' property)."
}

$oldMap = @{}
foreach ($p in $previous.Settings.PSObject.Properties) { $oldMap[$p.Name] = [string]$p.Value }

$drift = New-Object System.Collections.Generic.List[object]

foreach ($name in $current.Keys) {
    if (-not $oldMap.ContainsKey($name)) {
        $drift.Add([pscustomobject]@{ Setting = $name; Before = '(not in baseline)'; After = $current[$name] })
        continue
    }
    if ($oldMap[$name] -ne $current[$name]) {
        $drift.Add([pscustomobject]@{ Setting = $name; Before = $oldMap[$name]; After = $current[$name] })
    }
}

foreach ($name in $oldMap.Keys) {
    if (-not $current.Contains($name)) {
        $drift.Add([pscustomobject]@{ Setting = $name; Before = $oldMap[$name]; After = '(no longer returned)' })
    }
}

Write-Host ''
Write-Host ("Comparing against baseline captured {0}" -f $previous.CapturedUtc) -ForegroundColor Cyan

if ($drift.Count -eq 0) {
    Write-Host 'No drift - every property matches the baseline.' -ForegroundColor Green
}
else {
    Write-Host ("{0} setting(s) changed:" -f $drift.Count) -ForegroundColor Yellow
    $drift | Sort-Object Setting | Format-Table -AutoSize -Wrap
}

Disconnect-SPOService

if ($FailOnDrift -and $drift.Count -gt 0) { exit 1 }
