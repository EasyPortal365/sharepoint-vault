<#
.SYNOPSIS
    *** THIS SCRIPT CHANGES SITE SETTINGS *** Configures the "Access Requests
    Settings" dialog of a site: who may share, and where access requests go.

.DESCRIPTION
    This is the settings dialog reached from Site permissions -> Access
    Requests Settings. Everything on it is per-site, so none of it is
    reachable from the SharePoint Online Management Shell - the script uses
    PnP.PowerShell and, for the two settings that have no cmdlet, CSOM.

    The dialog maps to the API like this:

      "Allow members to share the site and individual files and folders"
          Web.MembersCanShare              -MembersCanShare

      "Allow members to invite others to the site members group"
          <members group>.AllowMembersEditMembership
                                           -MembersCanInvite

      "Allow access requests"              -AllowAccessRequests
      "...send them to the owners group"   -SendToOwnersGroup
      "...send them to this address"       -AccessRequestEmail
      "Include a custom message"           -CustomMessage

    Supports -WhatIf and -Confirm; run it with -WhatIf first, always. Before
    changing anything it writes the current state of every site in scope to
    a CSV, produced even under -WhatIf - that file is your rollback.

    Only the settings you pass are touched. Omit a parameter and the site
    keeps what it had.

    Two dependencies the dialog enforces and the API does not:

      1. Members cannot share the site unless they may also invite people to
         the members group. Setting -MembersCanShare $true without
         -MembersCanInvite $true produces a site where the first checkbox is
         ticked and site sharing still does not work. The script warns.
      2. A tenant administrator can override member sharing for the whole
         tenant (Web.TenantAdminMembersCanShare). When that is Off, writing
         MembersCanShare succeeds and changes nothing observable. The script
         reads the override and says so rather than reporting a hollow
         success.

.PARAMETER SiteUrl
    One or more site URLs to configure.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER MembersCanShare
    $true / $false - may members share the site, files and folders.

.PARAMETER MembersCanInvite
    $true / $false - may members add people to the site members group.

.PARAMETER AllowAccessRequests
    $true / $false - whether the access request page is offered at all.
    With $false the recipient settings below are irrelevant and ignored.

.PARAMETER SendToOwnersGroup
    Route access requests to the site owners group (the first radio button).
    Mutually exclusive with -AccessRequestEmail.

.PARAMETER AccessRequestEmail
    Route access requests to this address instead of the owners group.

.PARAMETER CustomMessage
    Message shown to users on the access request page. Pass an empty string
    to clear it.

.PARAMETER BackupPath
    CSV with the pre-change state. Defaults to a timestamped file.

.EXAMPLE
    .\Set-SiteAccessRequestSettings.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -MembersCanShare $false -WhatIf

    *** This script CHANGES site access request settings. Run with -WhatIf first. ***
    Backup written to .\AccessRequestSettings_Backup_20260901-101500.csv

    https://contoso.sharepoint.com/sites/projects
      current  MembersCanShare=True  MembersCanInvite=True  AccessRequests=owners group  Message=(none)
      tenant   member sharing override: Unspecified (not overridden)

    What if: Performing the operation "MembersCanShare: True -> False" on
    target "https://contoso.sharepoint.com/sites/projects".

    Changed : 0
    Skipped : 0
    FAILED  : 0

.EXAMPLE
    .\Set-SiteAccessRequestSettings.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000 -AllowAccessRequests $true -AccessRequestEmail helpdesk@contoso.com -CustomMessage "Tell us which project you need."

    https://contoso.sharepoint.com/sites/projects
      current  MembersCanShare=True  MembersCanInvite=True  AccessRequests=owners group  Message=(none)
      changed  access requests -> helpdesk@contoso.com
      changed  custom message set (31 chars)

    Changed : 2 setting(s) across 1 site(s)
    Skipped : 0
    FAILED  : 0

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in; needs Full Control on the site.
    Rollback : The backup CSV holds the previous value of every setting per
               site. Replay it by feeding the columns back as parameters.
    Caveat   : On a group-connected (Teams) site the members group is the
               Microsoft 365 group. Restricting invitations here does not
               stop an owner adding members from Teams or Outlook.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [bool]$MembersCanShare,

    [bool]$MembersCanInvite,

    [bool]$AllowAccessRequests,

    [switch]$SendToOwnersGroup,

    [string]$AccessRequestEmail,

    [string]$CustomMessage,

    [string]$BackupPath = ".\AccessRequestSettings_Backup_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'

$setShare   = $PSBoundParameters.ContainsKey('MembersCanShare')
$setInvite  = $PSBoundParameters.ContainsKey('MembersCanInvite')
$setAllow   = $PSBoundParameters.ContainsKey('AllowAccessRequests')
$setEmail   = $PSBoundParameters.ContainsKey('AccessRequestEmail')
$setMessage = $PSBoundParameters.ContainsKey('CustomMessage')

if (-not ($setShare -or $setInvite -or $setAllow -or $setEmail -or $SendToOwnersGroup -or $setMessage)) {
    throw 'Nothing to do - pass at least one setting. Run Get-Help on this script for the list.'
}
if ($SendToOwnersGroup -and $setEmail) {
    throw 'Use either -SendToOwnersGroup or -AccessRequestEmail, not both - they are the two radio buttons of one choice.'
}
# The dialog enforces this dependency; the API does not.
if ($setShare -and $MembersCanShare -and $setInvite -and -not $MembersCanInvite) {
    Write-Warning 'MembersCanShare=$true with MembersCanInvite=$false leaves the first checkbox ticked while site sharing still does not work. That is the combination the dialog refuses to save.'
}

Write-Host '*** This script CHANGES site access request settings. Run with -WhatIf first. ***' -ForegroundColor Red

$backup  = New-Object System.Collections.Generic.List[object]
$changed = 0
$skipped = 0
$failed  = New-Object System.Collections.Generic.List[string]

# --- Pass 1: read current state of everything, strictly ------------------
$state = New-Object System.Collections.Generic.List[object]

foreach ($url in $SiteUrl) {
    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        $web = Get-PnPWeb -Includes MembersCanShare, RequestAccessEmail, UseAccessRequestDefault, AccessRequestSiteDescription, TenantAdminMembersCanShare, AssociatedMemberGroup

        $memberGroupTitle = ''
        $canInvite = $null
        if ($web.AssociatedMemberGroup -and $web.AssociatedMemberGroup.ServerObjectIsNull -ne $true) {
            try {
                $mg = Get-PnPProperty -ClientObject $web.AssociatedMemberGroup -Property Title, AllowMembersEditMembership
                $memberGroupTitle = [string]$web.AssociatedMemberGroup.Title
                $canInvite = [bool]$web.AssociatedMemberGroup.AllowMembersEditMembership
            }
            catch {
                Write-Warning ("{0}: members group could not be read - membership settings will be skipped for this site." -f $url)
            }
        }

        $recipient = if ($web.UseAccessRequestDefault) { 'owners group' }
                     elseif ($web.RequestAccessEmail)  { [string]$web.RequestAccessEmail }
                     else { 'disabled' }

        $state.Add([pscustomobject]@{
            Url              = $url
            Web              = $web
            MembersCanShare  = [bool]$web.MembersCanShare
            MembersCanInvite = $canInvite
            MemberGroupTitle = $memberGroupTitle
            Recipient        = $recipient
            RequestEmail     = [string]$web.RequestAccessEmail
            UseOwnersGroup   = [bool]$web.UseAccessRequestDefault
            CustomMessage    = [string]$web.AccessRequestSiteDescription
            TenantOverride   = [string]$web.TenantAdminMembersCanShare
        })
    }
    catch {
        # A site whose current state cannot be read is never written to.
        Write-Warning ("SKIPPED {0} - current settings could not be read: {1}" -f $url, $_.Exception.Message)
        $failed.Add($url)
    }
}

if ($state.Count -eq 0) {
    Write-Warning 'Not one site could be read. This is not the same as "nothing to change".'
    return
}

# --- Backup BEFORE any write ---------------------------------------------
foreach ($s in $state) {
    $backup.Add([pscustomobject]@{
        Url                      = $s.Url
        MembersCanShareBefore    = $s.MembersCanShare
        MembersCanInviteBefore   = $s.MembersCanInvite
        MemberGroup              = $s.MemberGroupTitle
        UseOwnersGroupBefore     = $s.UseOwnersGroup
        RequestAccessEmailBefore = $s.RequestEmail
        CustomMessageBefore      = $s.CustomMessage
        TenantSharingOverride    = $s.TenantOverride
        CapturedUtc              = (Get-Date).ToUniversalTime().ToString('o')
    })
}
$backup | Export-Csv -Path $BackupPath -NoTypeInformation -Encoding UTF8
Write-Host ("Backup written to {0}" -f (Resolve-Path $BackupPath)) -ForegroundColor Green

# --- Pass 2: apply --------------------------------------------------------
foreach ($s in $state) {
    Write-Host ''
    Write-Host $s.Url -ForegroundColor Cyan

    $inviteShown = if ($null -eq $s.MembersCanInvite) { '(no members group)' } else { $s.MembersCanInvite }
    $msgShown    = if ($s.CustomMessage) { "$($s.CustomMessage.Length) chars" } else { '(none)' }
    Write-Host ("  current  MembersCanShare={0}  MembersCanInvite={1}  AccessRequests={2}  Message={3}" -f $s.MembersCanShare, $inviteShown, $s.Recipient, $msgShown)

    $overrideText = switch ($s.TenantOverride) {
        'Off' { 'Off - member sharing is BLOCKED tenant-wide, MembersCanShare here has no observable effect' }
        'On'  { 'On - member sharing is forced on tenant-wide' }
        default { "$($s.TenantOverride) (not overridden)" }
    }
    Write-Host ("  tenant   member sharing override: {0}" -f $overrideText) -ForegroundColor DarkGray

    try {
        Connect-PnPOnline -Url $s.Url -Interactive -ClientId $ClientId

        # 1. Members may share the site
        if ($setShare -and $s.MembersCanShare -ne $MembersCanShare) {
            if ($s.TenantOverride -eq 'Off' -and $MembersCanShare) {
                Write-Host '  SKIPPED  MembersCanShare - blocked by the tenant-wide override, the write would be cosmetic' -ForegroundColor Yellow
                $skipped++
            }
            elseif ($PSCmdlet.ShouldProcess($s.Url, ("MembersCanShare: {0} -> {1}" -f $s.MembersCanShare, $MembersCanShare))) {
                Set-PnPWeb -MembersCanShare $MembersCanShare
                Write-Host ("  changed  MembersCanShare {0} -> {1}" -f $s.MembersCanShare, $MembersCanShare) -ForegroundColor Green
                $changed++
            }
        }

        # 2. Members may invite to the members group
        if ($setInvite) {
            if ($null -eq $s.MembersCanInvite) {
                Write-Host '  SKIPPED  MembersCanInvite - this site has no associated members group' -ForegroundColor Yellow
                $skipped++
            }
            elseif ($s.MembersCanInvite -ne $MembersCanInvite) {
                if ($PSCmdlet.ShouldProcess($s.Url, ("MembersCanInvite: {0} -> {1}" -f $s.MembersCanInvite, $MembersCanInvite))) {
                    Set-PnPGroup -Identity $s.MemberGroupTitle -AllowMembersEditMembership $MembersCanInvite
                    Write-Host ("  changed  MembersCanInvite {0} -> {1}  (group: {2})" -f $s.MembersCanInvite, $MembersCanInvite, $s.MemberGroupTitle) -ForegroundColor Green
                    $changed++
                }
            }
        }

        # 3. Access requests on/off, and the recipient
        if ($setAllow -and -not $AllowAccessRequests) {
            if ($s.Recipient -ne 'disabled') {
                if ($PSCmdlet.ShouldProcess($s.Url, 'Disable access requests')) {
                    Set-PnPRequestAccessEmails -Disabled
                    Write-Host '  changed  access requests -> disabled' -ForegroundColor Green
                    $changed++
                }
            }
        }
        else {
            if ($SendToOwnersGroup -and -not $s.UseOwnersGroup) {
                if ($PSCmdlet.ShouldProcess($s.Url, 'Route access requests to the owners group')) {
                    # No cmdlet for this radio button - it is a CSOM call.
                    $w = Get-PnPWeb
                    $w.SetUseAccessRequestDefaultAndUpdate($true)
                    Invoke-PnPQuery
                    Write-Host '  changed  access requests -> owners group' -ForegroundColor Green
                    $changed++
                }
            }
            elseif ($setEmail -and $s.RequestEmail -ne $AccessRequestEmail) {
                if ($PSCmdlet.ShouldProcess($s.Url, ("Route access requests to {0}" -f $AccessRequestEmail))) {
                    Set-PnPRequestAccessEmails -Emails $AccessRequestEmail
                    Write-Host ("  changed  access requests -> {0}" -f $AccessRequestEmail) -ForegroundColor Green
                    $changed++
                }
            }
        }

        # 4. Custom message on the request page
        if ($setMessage -and $s.CustomMessage -ne $CustomMessage) {
            if ($PSCmdlet.ShouldProcess($s.Url, 'Set the access request page message')) {
                # Also CSOM only - the property itself is read-only.
                $w2 = Get-PnPWeb
                $w2.SetAccessRequestSiteDescriptionAndUpdate($CustomMessage)
                Invoke-PnPQuery
                $what = if ($CustomMessage) { "set ($($CustomMessage.Length) chars)" } else { 'cleared' }
                Write-Host ("  changed  custom message {0}" -f $what) -ForegroundColor Green
                $changed++
            }
        }
    }
    catch {
        Write-Warning ("FAILED {0}: {1}" -f $s.Url, $_.Exception.Message)
        $failed.Add($s.Url)
    }
}

Write-Host ''
Write-Host ("Changed : {0} setting(s) across {1} site(s)" -f $changed, $state.Count) -ForegroundColor Cyan
Write-Host ("Skipped : {0}" -f $skipped) -ForegroundColor Cyan
Write-Host ("FAILED  : {0}" -f $failed.Count) -ForegroundColor Cyan

if ($failed.Count -gt 0) {
    Write-Host ''
    Write-Warning ("{0} site(s) FAILED - their settings are unchanged:" -f $failed.Count)
    foreach ($u in $failed) { Write-Host ("  {0}" -f $u) -ForegroundColor Red }
}

try { Disconnect-PnPOnline } catch { }
