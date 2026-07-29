<#
.SYNOPSIS
    Tests whether a search managed property really exists, is retrievable and
    is queryable - before you build anything on top of it.

.DESCRIPTION
    SharePoint Search does not fail on a managed property that does not
    exist. It drops the unknown name from selectproperties and answers
    HTTP 200 with a perfectly normal result set, and a KQL filter on a
    nonexistent property quietly matches nothing. Both failure modes look
    exactly like "there is no data", which is how a feature ships, works on
    the developer tenant, and returns zero rows at every customer.

    This script settles it with a control sample:

      1. Query with the property in selectproperties. Does it come back in
         the rows?
      2. Query with a deliberately nonsensical property name. If THAT also
         appears to come back, the detection itself is unreliable and the
         script says so instead of reporting a result.
      3. Optionally query with a KQL filter on the property to see whether
         it is queryable, not merely retrievable - the two are separate
         flags in the schema and a property can be one without the other.

    READ-ONLY: this script changes no search schema and no content.

    Practical note: auto-created properties for Choice columns (the
    ows_q_CHCS_* / *OWSCHCS family) are typically retrievable but NOT
    queryable. Making them queryable means mapping a crawled property to a
    RefinableString slot in the search schema - a tenant admin action. Do
    not build a customer-facing feature on a property this script reports
    as not queryable.

.PARAMETER SiteUrl
    Site to run the queries against.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER Name
    One or more managed property names to test.

.PARAMETER SampleValue
    A value you expect the property to hold somewhere. When given, the
    script also runs `Name:SampleValue` to prove the property is queryable.

.PARAMETER BaseQuery
    Query used to fetch sample rows. Default: IsDocument:1

.EXAMPLE
    .\Test-SearchManagedProperty.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -Name RefinableString00

.EXAMPLE
    .\Test-SearchManagedProperty.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -Name ViewableByExternalUsers, ContentTypeId -SampleValue true

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in. No admin rights needed - this
               is a read-only query as yourself.
    Related  : gotchas/search/unknown-managed-properties-fail-silently.md
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SiteUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [Parameter(Mandatory = $true)]
    [string[]]$Name,

    [string]$SampleValue,

    [string]$BaseQuery = 'IsDocument:1'
)

$ErrorActionPreference = 'Stop'

# A name nothing could possibly map to. If this "works", the test is broken.
$controlName = 'VaultControlPropertyThatCannotExist99'

function Test-Retrievable {
    param([string]$Property)

    $result = Submit-PnPSearchQuery -Query $BaseQuery -MaxResults 20 -SelectProperties $Property -ErrorAction Stop
    $rows = @($result.ResultRows)
    if ($rows.Count -eq 0) { return @{ Rows = 0; Present = $false; NonEmpty = 0 } }

    $present  = $false
    $nonEmpty = 0
    foreach ($row in $rows) {
        if ($row.ContainsKey($Property)) {
            $present = $true
            if (-not [string]::IsNullOrEmpty([string]$row[$Property])) { $nonEmpty++ }
        }
    }
    return @{ Rows = $rows.Count; Present = $present; NonEmpty = $nonEmpty }
}

Write-Host "Connecting to $SiteUrl ..." -ForegroundColor Cyan
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

Write-Host ("Base query: {0}" -f $BaseQuery) -ForegroundColor DarkGray

# --- Control sample first ------------------------------------------------
$control = Test-Retrievable -Property $controlName
if ($control.Rows -eq 0) {
    Write-Warning "The base query returned no results at all. Nothing can be tested against an empty result set - widen -BaseQuery."
    try { Disconnect-PnPOnline } catch { }
    return
}
if ($control.Present) {
    Write-Warning "The control property '$controlName' appears in the result rows. Detection is unreliable on this tenant - do not trust the results below."
}
else {
    Write-Host ("Control OK: a nonexistent property does not show up ({0} sample rows)." -f $control.Rows) -ForegroundColor DarkGray
}

Write-Host ''
$results = New-Object System.Collections.Generic.List[object]

foreach ($prop in $Name) {
    Write-Host ("Testing {0} ..." -f $prop) -ForegroundColor Cyan

    $retr = Test-Retrievable -Property $prop

    $queryable = ''
    $queryHits = ''
    if ($SampleValue) {
        try {
            # Parenthesised so the filter cannot be escaped by an OR in the base query.
            $filtered = Submit-PnPSearchQuery -Query ('({0}) AND {1}:{2}' -f $BaseQuery, $prop, $SampleValue) -MaxResults 5 -ErrorAction Stop
            $queryHits = $filtered.TotalRows
            $queryable = ($filtered.TotalRows -gt 0)
        }
        catch {
            $queryable = 'query failed'
            $queryHits = $_.Exception.Message
        }
    }

    $verdict = if (-not $retr.Present)      { 'NOT RETRIEVABLE - property is unknown to search, or holds no value on any sampled row' }
               elseif ($retr.NonEmpty -eq 0) { 'Retrievable but EMPTY on every sampled row - exists in the schema, carries no data here' }
               else                          { 'Retrievable with data' }

    $results.Add([pscustomobject]@{
        Property     = $prop
        Retrievable  = $retr.Present
        RowsSampled  = $retr.Rows
        RowsWithData = $retr.NonEmpty
        Queryable    = $queryable
        FilterHits   = $queryHits
        Verdict      = $verdict
    })
}

Write-Host ''
$results | Format-Table -AutoSize -Wrap

Write-Host ''
Write-Host 'Reading the result:' -ForegroundColor Cyan
Write-Host '  Retrievable=False  -> selectproperties silently drops it. Anything you build on it returns empty forever.'
Write-Host '  Retrievable=True, Queryable=False -> you can read it back, but you cannot filter on it in KQL.'
Write-Host '  Map a crawled property to a RefinableString slot to make it queryable (tenant admin, then a reindex).'

try { Disconnect-PnPOnline } catch { }
