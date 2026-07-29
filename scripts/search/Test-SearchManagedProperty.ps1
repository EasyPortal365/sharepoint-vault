<#
.SYNOPSIS
    Tests whether a search managed property really exists, holds data and can
    be filtered on - before you build anything on top of it.

.DESCRIPTION
    SharePoint Search does not fail on a managed property that does not exist.
    It answers HTTP 200 with a normal result set, and a KQL filter on a
    nonexistent property quietly matches nothing. Both failure modes look
    exactly like "there is no data", which is how a feature ships, works on
    the developer tenant, and returns zero rows at every customer.

    The obvious test does not work. Asking for a made-up property in
    selectproperties returns it as a cell like any other:

        selectproperties='Path,ZzFakeProp123'
        -> Cells: Path (Edm.String), ZzFakeProp123 (Null)

    And ValueType does not separate the cases either - a real but empty
    property (RefinableString00 on a tenant that never mapped it) reports
    Null just like the fake one. Presence of the key proves nothing.

    What DOES separate them is sorting. Sorting is resolved against the
    search schema, so the service answers differently for each case, and the
    three answers are distinguishable:

        sortlist='<real, sortable>'      -> HTTP 200
        sortlist='<real, not sortable>'  -> "An unknown error occurred."
        sortlist='<does not exist>'      -> "We didn't understand your search
                                             terms. Make sure they're using
                                             proper syntax."

    This script combines both probes and refuses to answer when its own
    control sample misbehaves.

    READ-ONLY: this script changes no search schema and no content.

    Practical note: auto-created properties for Choice columns (the
    *OWSCHCS family) usually do not exist as queryable managed properties at
    all. Making one queryable means mapping the crawled property to a
    RefinableString slot - a tenant admin action followed by a reindex. Do
    not build a customer-facing feature on a property this script reports as
    missing.

.PARAMETER SiteUrl
    Site to run the queries against.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER Name
    One or more managed property names to test.

.PARAMETER SampleValue
    A value you expect the property to hold somewhere. When given, the script
    also runs `Name:SampleValue` to prove the property is filterable.

.PARAMETER BaseQuery
    Query used to fetch sample rows. Default: IsDocument:1

.EXAMPLE
    .\Test-SearchManagedProperty.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -Name ViewableByExternalUsers,RefinableString00,ContentTypeId,ZzTotallyMadeUp42

    Base query: IsDocument:1
    Control OK: invented property names are rejected, so a "missing" verdict
    below is meaningful.
    Sampling 25 row(s) per property.

    Property                Exists Sortable RowsWithData Filterable Verdict
    --------                ------ -------- ------------ ---------- -------
    ViewableByExternalUsers   True     True           25       True Exists and carries data
    RefinableString00         True     True            0      False Exists in the schema but empty here
    ContentTypeId             True    False           25      False Exists and carries data
    ZzTotallyMadeUp42        False    False            0      False DOES NOT EXIST

    Four different real answers: a fabricated name, a real-but-unmapped
    RefinableString00, a real-but-unsortable ContentTypeId, and one that works.
    selectproperties alone reports the first two identically.

.EXAMPLE
    .\Test-SearchManagedProperty.ps1 -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 00000000-0000-0000-0000-000000000000 -Name ViewableByExternalUsers -SampleValue true

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in. No admin rights needed - this
               is a read-only query as yourself.
    Related  : gotchas/search/unknown-managed-properties-fail-silently.md
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
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

# Names nothing could possibly map to. If these behave like real properties,
# the whole method is broken and the script says so instead of guessing.
$controlNames = @('VaultControlPropertyCannotExist99', 'VaultControlPropertyCannotExist98')

# The service's way of saying "no such managed property".
$unknownPropertyMarker = "didn't understand your search terms"

function Invoke-SearchQuery {
    param([string]$QueryString)
    return Invoke-PnPSPRestMethod -Method Get -Url $QueryString
}

function Get-CellReport {
    <# Retrievability: does the property carry a typed value on any sampled row? #>
    param([string]$Property)

    $url = "/_api/search/query?querytext='$BaseQuery'&selectproperties='$Property'&rowlimit=25"
    $res = Invoke-SearchQuery -QueryString $url
    $rows = @($res.PrimaryQueryResult.RelevantResults.Table.Rows)

    $typed = 0
    $withData = 0
    foreach ($row in $rows) {
        $cell = $row.Cells | Where-Object { $_.Key -eq $Property }
        if (-not $cell) { continue }
        if ($cell.ValueType -and $cell.ValueType -ne 'Null') { $typed++ }
        if (-not [string]::IsNullOrEmpty([string]$cell.Value)) { $withData++ }
    }

    return @{ Rows = $rows.Count; Typed = $typed; WithData = $withData }
}

function Get-SortProbe {
    <# Existence: sorting is resolved against the schema, so it tells the truth. #>
    param([string]$Property)

    $url = "/_api/search/query?querytext='$BaseQuery'&sortlist='$($Property):descending'&rowlimit=1"
    try {
        [void](Invoke-SearchQuery -QueryString $url)
        return @{ Exists = $true;  Sortable = $true;  Detail = 'sorts fine' }
    }
    catch {
        $msg = $_.Exception.Message
        if ($msg -like "*$unknownPropertyMarker*") {
            return @{ Exists = $false; Sortable = $false; Detail = 'service does not recognise the name' }
        }
        # Any other error means the name resolved but sorting was refused.
        return @{ Exists = $true; Sortable = $false; Detail = 'exists but is not sortable' }
    }
}

Write-Host "Connecting to $SiteUrl ..." -ForegroundColor Cyan
Connect-PnPOnline -Url $SiteUrl -Interactive -ClientId $ClientId

Write-Host ("Base query: {0}" -f $BaseQuery) -ForegroundColor DarkGray

# --- Control samples first ----------------------------------------------
$controlOk = $true
foreach ($c in $controlNames) {
    $probe = Get-SortProbe -Property $c
    if ($probe.Exists) {
        Write-Warning "Control property '$c' was NOT rejected by the service. The detection method does not hold on this tenant."
        $controlOk = $false
    }
}

if ($controlOk) {
    Write-Host 'Control OK: invented property names are rejected, so a "missing" verdict below is meaningful.' -ForegroundColor DarkGray
}
else {
    Write-Host 'Control FAILED - results below are reported but must not be trusted.' -ForegroundColor Red
}

$sample = Get-CellReport -Property 'Path'
if ($sample.Rows -eq 0) {
    Write-Warning 'The base query returned no results at all. Nothing can be tested against an empty result set - widen -BaseQuery.'
    try { Disconnect-PnPOnline } catch { }
    return
}
Write-Host ("Sampling {0} row(s) per property." -f $sample.Rows) -ForegroundColor DarkGray
Write-Host ''

# --- The actual test ------------------------------------------------------
$results = New-Object System.Collections.Generic.List[object]

foreach ($prop in $Name) {
    Write-Host ("Testing {0} ..." -f $prop) -ForegroundColor Cyan

    $cells = Get-CellReport -Property $prop
    $sort  = Get-SortProbe  -Property $prop

    # A typed cell proves existence on its own, whatever sorting says.
    $exists = $sort.Exists -or ($cells.Typed -gt 0)

    $filterable = ''
    $filterHits = ''
    if ($SampleValue) {
        try {
            # Parenthesised so the filter cannot be escaped by an OR in the base query.
            $url = "/_api/search/query?querytext='($BaseQuery) AND $($prop):$SampleValue'&rowlimit=1"
            $res = Invoke-SearchQuery -QueryString $url
            $filterHits = $res.PrimaryQueryResult.RelevantResults.TotalRows
            $filterable = ($filterHits -gt 0)
        }
        catch {
            $filterable = 'query failed'
            $filterHits = $_.Exception.Message
        }
    }

    $verdict =
        if (-not $exists)            { 'DOES NOT EXIST - anything built on it returns empty forever' }
        elseif ($cells.WithData -gt 0) { 'Exists and carries data' }
        elseif ($cells.Typed -gt 0)  { 'Exists, typed, but empty on every sampled row' }
        else                         { 'Exists in the schema but empty here - likely never mapped or not crawled yet' }

    $results.Add([pscustomobject]@{
        Property     = $prop
        Exists       = $exists
        Sortable     = $sort.Sortable
        RowsSampled  = $cells.Rows
        RowsWithData = $cells.WithData
        Filterable   = $filterable
        FilterHits   = $filterHits
        Verdict      = $verdict
    })
}

Write-Host ''
$results | Format-Table -AutoSize -Wrap

Write-Host ''
Write-Host 'Reading the result:' -ForegroundColor Cyan
Write-Host '  Exists=False           -> the name is unknown to search. selectproperties still returns it as a Null cell,'
Write-Host '                            so "no data" and "no such property" are indistinguishable without this test.'
Write-Host '  Exists=True, no data   -> real property, nothing indexed into it here (a RefinableString nobody mapped).'
Write-Host '  Sortable=False         -> real property that cannot be used in sortlist; filtering may still work.'

if (-not $controlOk) {
    Write-Host ''
    Write-Warning 'Control sample failed - treat every row above as unverified.'
}

try { Disconnect-PnPOnline } catch { }
