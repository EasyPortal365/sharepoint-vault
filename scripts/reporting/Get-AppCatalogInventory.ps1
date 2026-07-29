<#
.SYNOPSIS
    Inventories SharePoint Framework solutions: what is in the tenant app
    catalog, what version each site actually runs, and which sites are behind.

.DESCRIPTION
    Uploading a new .sppkg to the app catalog does not update anything by
    itself. Every site that installed the app keeps running the version it
    installed until somebody clicks "Get it" / "Update" (or the app is
    tenant-deployed). The result is a tenant where the catalog says 1.9 and
    half the sites still run 1.4 - and nobody notices, because the app works.

    This script lists the catalog versions and, for each site you pass in,
    the installed version, so the gap is visible.

    READ-ONLY: this script installs and updates nothing.

    Module note: uses PnP.PowerShell - the official SharePoint Online
    Management Shell cannot read app catalog contents.

.PARAMETER TenantAppCatalogUrl
    URL of the tenant app catalog, e.g.
    https://contoso.sharepoint.com/sites/appcatalog

.PARAMETER SiteUrl
    Sites whose installed apps should be compared against the catalog.
    Omit to report the catalog contents only.

.PARAMETER ClientId
    Client ID of your own Entra ID app registration used by PnP.PowerShell.
    https://pnp.github.io/powershell/articles/registerapplication.html

.PARAMETER OutputPath
    CSV file to create. Defaults to a timestamped file in the current directory.

.EXAMPLE
    .\Get-AppCatalogInventory.ps1 -TenantAppCatalogUrl https://contoso.sharepoint.com/sites/appcatalog -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    .\Get-AppCatalogInventory.ps1 -TenantAppCatalogUrl https://contoso.sharepoint.com/sites/appcatalog -SiteUrl (Get-Content .\sites.txt) -ClientId 00000000-0000-0000-0000-000000000000

.NOTES
    Requires : PnP.PowerShell 2.x or newer (Install-Module PnP.PowerShell)
    Auth     : Interactive (browser) sign-in. Reading the tenant catalog
               needs at least read access to the app catalog site.
    Caveat   : A solution that hosts its bundle on an external CDN still
               pins the bundle filename in the package manifest, so an
               out-of-date InstalledVersion means out-of-date code even
               when the CDN is current.
    Samples  : scripts/sample-outputs.md - what this prints, from a real run
    Source   : https://github.com/EasyPortal365/sharepoint-vault
#>
#Requires -Modules PnP.PowerShell

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantAppCatalogUrl,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [string[]]$SiteUrl,

    [string]$OutputPath = ".\AppCatalogInventory_$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[object]

Write-Host "Reading tenant app catalog $TenantAppCatalogUrl ..." -ForegroundColor Cyan
Connect-PnPOnline -Url $TenantAppCatalogUrl -Interactive -ClientId $ClientId

$catalog = @(Get-PnPApp -Scope Tenant)
Write-Host ("  {0} solution(s) in the catalog." -f $catalog.Count) -ForegroundColor Cyan

$catalogByTitle = @{}
foreach ($app in $catalog) {
    $catalogByTitle[$app.Title] = $app

    $report.Add([pscustomobject]@{
        Scope             = 'Tenant catalog'
        SiteUrl           = $TenantAppCatalogUrl
        Title             = $app.Title
        AppCatalogVersion = $app.AppCatalogVersion
        InstalledVersion  = ''
        UpToDate          = ''
        Deployed          = $app.Deployed
        IsClientSide      = $app.IsClientSideSolution
        ProductId         = $app.Id
    })
}

foreach ($url in $SiteUrl) {
    Write-Host "Reading installed apps on $url ..." -ForegroundColor Cyan
    try {
        Connect-PnPOnline -Url $url -Interactive -ClientId $ClientId
        $installed = @(Get-PnPApp -Scope Site)

        foreach ($app in $installed) {
            $catalogVersion = ''
            if ($catalogByTitle.ContainsKey($app.Title)) {
                $catalogVersion = [string]$catalogByTitle[$app.Title].AppCatalogVersion
            }

            $upToDate = ''
            if ($catalogVersion) {
                $upToDate = ([string]$app.InstalledVersion -eq $catalogVersion)
            }

            $report.Add([pscustomobject]@{
                Scope             = 'Site'
                SiteUrl           = $url
                Title             = $app.Title
                AppCatalogVersion = $catalogVersion
                InstalledVersion  = $app.InstalledVersion
                UpToDate          = $upToDate
                Deployed          = $app.Deployed
                IsClientSide      = $app.IsClientSideSolution
                ProductId         = $app.Id
            })

            if ($upToDate -eq $false) {
                Write-Host ("  {0}: installed {1}, catalog {2}" -f $app.Title, $app.InstalledVersion, $catalogVersion) -ForegroundColor Yellow
            }
        }

        if ($installed.Count -eq 0) {
            Write-Host '  No apps installed on this site.' -ForegroundColor DarkGray
        }
    }
    catch {
        Write-Warning "Failed to read ${url}: $($_.Exception.Message)"
    }
}

$report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host ''
Write-Host ("Done. {0} row(s) written to {1}" -f $report.Count, (Resolve-Path $OutputPath)) -ForegroundColor Green

$behind = @($report | Where-Object { $_.UpToDate -eq $false })
if ($behind.Count -gt 0) {
    Write-Host ("{0} site installation(s) are behind the catalog version." -f $behind.Count) -ForegroundColor Yellow
}

try { Disconnect-PnPOnline } catch { }
