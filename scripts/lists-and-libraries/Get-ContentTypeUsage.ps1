<#
.SYNOPSIS
    Finds where a site content type is actually used - which lists have it
    attached, and how many items carry it.

.DESCRIPTION
    Before you change, retire or republish a content type you need to know
    what breaks. SharePoint will happily let you delete a site content type
    while list copies of it remain in use, and the list copies keep working
    with the old schema - which is exactly how a content type "update" ends
    up applied to two libraries out of eleven.

    This script walks every list on the given sites, matches list content
    types back to their parent site content type, and counts the items using
    each one.

    READ-ONLY: this script makes no changes.

    Content type Ids are hierarchical: a list copy's Id starts with the
    parent's Id and appends a suffix. Matching on the Id prefix therefore
    finds inherited copies, which matching on the name never does reliably
    (two different content types can share a name across scopes).

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell has no content type cmdlets.

.PARAMETER SiteUrl
    One or more full site URLs to scan.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER ContentType
    Name or Id of the content type to trace. Omit to report every content
    type in use on the site.

.PARAMETER CountItems
    Count items per content type. One extra query per list content type -
    accurate, but slower on content-heavy sites.

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-ContentTypeUsage.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -ContentType "Project Document"

.EXAMPLE
    .\Get-ContentTypeUsage.ps1 -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000 -CountItems

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in per site.
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

    [string]$ContentType,

    [switch]$CountItems,

    [string]$OutputPath = ".\ContentTypeUsage_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

foreach ($url in $SiteUrl) {
    Write-Host "Scanning $url ..." -ForegroundColor Cyan

    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId

        # Resolve the target to an Id prefix so inherited list copies match too.
        $targetId   = $null
        $targetName = $null
        if ($ContentType) {
            $siteCt = @(Get-PnPContentType | Where-Object {
                $_.Name -eq $ContentType -or [string]$_.Id -eq $ContentType
            })

            if ($siteCt.Count -eq 0) {
                Write-Warning "$url : content type '$ContentType' does not exist at site level. Reporting list-level matches by name only."
                $targetName = $ContentType
            }
            else {
                $targetId   = [string]$siteCt[0].Id
                $targetName = $siteCt[0].Name
                Write-Host ("  Site content type: {0}  ({1})" -f $targetName, $targetId)
            }
        }

        $lists = @(Get-PnPList -Includes Hidden, ContentTypesEnabled, ItemCount |
            Where-Object { -not $_.Hidden })

        foreach ($list in $lists) {
            $listCts = @()
            try { $listCts = @(Get-PnPContentType -List $list) } catch { continue }

            foreach ($ct in $listCts) {
                $ctId = [string]$ct.Id

                if ($targetId   -and -not $ctId.StartsWith($targetId, [StringComparison]::OrdinalIgnoreCase)) { continue }
                if ($targetName -and -not $targetId -and $ct.Name -ne $targetName) { continue }

                $itemCount = ''
                if ($CountItems) {
                    $query = @"
<View Scope="RecursiveAll">
  <Query><Where><Eq><FieldRef Name="ContentTypeId" /><Value Type="ContentTypeId">$ctId</Value></Eq></Where></Query>
  <ViewFields><FieldRef Name="ID" /></ViewFields>
  <RowLimit Paged="TRUE">2000</RowLimit>
</View>
"@
                    try   { $itemCount = @(Get-PnPListItem -List $list -Query $query -PageSize 2000).Count }
                    catch { $itemCount = '(count failed)' }
                }

                $report.Add([pscustomobject]@{
                    SiteUrl            = $url
                    ListTitle          = $list.Title
                    ListItemCount      = $list.ItemCount
                    ContentTypesOnList = $list.ContentTypesEnabled
                    ContentTypeName    = $ct.Name
                    ContentTypeId      = $ctId
                    ReadOnly           = $ct.ReadOnly
                    Sealed             = $ct.Sealed
                    ItemsUsingIt       = $itemCount
                })
            }
        }

        $found = @($report | Where-Object { $_.SiteUrl -eq $url })
        Write-Host ("  {0} list content type binding(s) found." -f $found.Count) -ForegroundColor Green
    }
    catch {
        Write-Warning "Failed to scan ${url}: $($_.Exception.Message)"
    }
}

Write-Host ''
if ($report.Count -gt 0) {
    $report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8
    Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green
}
else {
    Write-Host 'Done. No matching content type usage found.' -ForegroundColor Green
}

try { Disconnect-PnPOnline } catch { }
