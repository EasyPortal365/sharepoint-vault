<#
.SYNOPSIS
    Finds where the "Everyone" and "Everyone except external users" claims
    have been granted permissions.

.DESCRIPTION
    The two tenant-wide claims are the classic accidental-oversharing vector:
    they look like an ordinary user in the people picker, they are easy to
    add, and nothing in the UI warns you that you just published a library
    to the whole organisation (Everyone even includes guests).

    Their login names are stable and are what this script matches on:

        Everyone                        c:0(.s|true
        Everyone except external users  c:0-.f|rolemanager|spo-grid-all-users/<tenantId>
        All Users (windows)             c:0!.s|windows
        All Users (membership)          c:0!.s|forms%3aid

    The script checks direct role assignments on the web and on every list
    with unique permissions, and also membership of ordinary SharePoint
    groups (a claim buried inside "Contoso Members" grants exactly the same
    access, but no permission report that only looks at role assignments
    will show it).

    READ-ONLY: this script makes no changes.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell cannot read role assignments.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-EveryoneClaimReport.ps1 -SiteUrl https://contoso.sharepoint.com/sites/hr -ClientId 00000000-0000-0000-0000-000000000000

    Scanning https://contoso.sharepoint.com/sites/hr ...
      2 grant(s) found.

    Done. 2 row(s) written to .\EveryoneClaims_20260729-143912.csv
    1 of them are the real 'Everyone' claim, which INCLUDES external guests.

    And what it prints when the scan is refused - the output that matters most
    on a security report, because the first version said "Nothing found" here:

    WARNING: Failed to scan https://contoso.sharepoint.com/sites/hr: Attempted to
    perform an unauthorized operation.

    1 site(s) could NOT be scanned - this report does not cover them:
      https://contoso.sharepoint.com/sites/hr
    Reading role assignments needs Full Control. Treat a clean result for these
    sites as unknown, not safe.

    Done, but NOT ONE site could be scanned. This is not a clean result - it is
    no result.

.EXAMPLE
    .\Get-EveryoneClaimReport.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in; needs Full Control on the site.
    Caveat   : Item-level grants are not scanned. A clean report means "no
               claim at web, list or group level", not "no claim anywhere".
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [string]$OutputPath = ".\EveryoneClaims_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

# This is a security report. "No claim found" and "the scan blew up" must never
# look the same in the output, so failures are counted and stated at the end.
$failedSites = New-Object System.Collections.Generic.List[string]

function Get-ClaimLabel {
    param([string]$LoginName)

    if ([string]::IsNullOrEmpty($LoginName)) { return $null }

    if ($LoginName -eq 'c:0(.s|true')                          { return 'Everyone (includes guests)' }
    if ($LoginName -like 'c:0-.f|rolemanager|spo-grid-all-users*') { return 'Everyone except external users' }
    if ($LoginName -eq 'c:0!.s|windows')                       { return 'All Users (windows)' }
    if ($LoginName -like 'c:0!.s|forms*')                      { return 'All Users (membership)' }
    return $null
}

function Add-Assignments {
    param($ClientObject, [string]$Site, [string]$Scope, [string]$Object)

    $assignments = Get-PnPProperty -ClientObject $ClientObject -Property RoleAssignments

    foreach ($ra in $assignments) {
        $member = Get-PnPProperty -ClientObject $ra -Property Member
        $label  = Get-ClaimLabel -LoginName $member.LoginName
        if (-not $label) { continue }

        $bindings = Get-PnPProperty -ClientObject $ra -Property RoleDefinitionBindings
        $roles = ($bindings | Select-Object -ExpandProperty Name) -join '+'

        $script:report.Add([pscustomobject]@{
            SiteUrl    = $Site
            Scope      = $Scope
            Object     = $Object
            Claim      = $label
            GrantedVia = 'Direct role assignment'
            Permission = $roles
            LoginName  = $member.LoginName
        })
    }
}

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $web = Get-PnPWeb -Includes ServerRelativeUrl
        Add-Assignments -ClientObject $web -Site $url -Scope 'Web' -Object $web.ServerRelativeUrl

        $lists = @(Get-PnPList -Includes HasUniqueRoleAssignments, Hidden |
            Where-Object { -not $_.Hidden -and $_.HasUniqueRoleAssignments })

        foreach ($list in $lists) {
            Add-Assignments -ClientObject $list -Site $url -Scope 'List' -Object $list.Title
        }

        # Claims hidden inside ordinary SharePoint groups.
        foreach ($group in @(Get-PnPGroup)) {
            if ($group.LoginName -like 'SharingLinks.*') { continue }

            $members = @()
            try { $members = @(Get-PnPGroupMember -Group $group.Id) } catch { continue }

            foreach ($m in $members) {
                $label = Get-ClaimLabel -LoginName $m.LoginName
                if (-not $label) { continue }

                $report.Add([pscustomobject]@{
                    SiteUrl    = $url
                    Scope      = 'Group membership'
                    Object     = $group.Title
                    Claim      = $label
                    GrantedVia = ('Member of SharePoint group "{0}"' -f $group.Title)
                    Permission = '(whatever the group holds)'
                    LoginName  = $m.LoginName
                })
            }
        }

        $found = @($report | Where-Object { $_.SiteUrl -eq $url })
        if ($found.Count -eq 0) {
            Write-Host '  No tenant-wide claim found at web, list or group level.' -ForegroundColor Green
        }
        else {
            Write-Host ("  {0} grant(s) found." -f $found.Count) -ForegroundColor Yellow
        }
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
        $failedSites.Add($url)
    }
}

Write-Host ''
if ($failedSites.Count -gt 0) {
    Write-Host ("{0} site(s) could NOT be scanned - this report does not cover them:" -f $failedSites.Count) -ForegroundColor Red
    foreach ($u in $failedSites) { Write-Host ("  {0}" -f $u) -ForegroundColor Red }
    Write-Host 'Reading role assignments needs Full Control. Treat a clean result for these sites as unknown, not safe.' -ForegroundColor Red
    Write-Host ''
}

if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

    $everyone = @($report | Where-Object { $_.Claim -like 'Everyone (*' })
    if ($everyone.Count -gt 0) {
        Write-Host ("  {0} of them are the real 'Everyone' claim, which INCLUDES external guests." -f $everyone.Count) -ForegroundColor Red
    }
}
elseif ($failedSites.Count -ge @($SiteUrl).Count) {
    Write-Host 'Done, but NOT ONE site could be scanned. This is not a clean result - it is no result.' -ForegroundColor Red
}
else {
    Write-Host 'Done. No tenant-wide claim found on the sites that were scanned.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
