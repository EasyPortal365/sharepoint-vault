---
title: "Kapitola 09 – SharePoint Online a PowerShell"
chapter: 9
course: MSHP-ONLINE
lang: cs
last-reviewed: 2026-07-18
---

# Kapitola 09 – SharePoint Online a PowerShell

Dva moduly pro správu SharePoint Online z příkazové řádky – oficiální **SharePoint Online Management Shell** a komunitní **PnP PowerShell** – a sada praktických skriptů pro reporting a správu.

## SharePoint Online Management Shell a PnP PowerShell

Existují dva hlavní moduly:

- **SharePoint Online Management Shell** – oficiální modul Microsoftu (`Microsoft.Online.SharePoint.PowerShell`), tenant-level cmdlety.
- **PnP PowerShell** – komunitní modul s bohatšími cmdlety na úrovni webů, seznamů a obsahu.

Instalace PowerShellu 7 ([dokumentace](https://learn.microsoft.com/en-gb/powershell/scripting/install/installing-powershell-on-windows)):

```powershell
# Jaký PowerShell mám?
$PSVersionTable.PSVersion

# Instalace / aktualizace PowerShellu přes winget
winget search --id Microsoft.PowerShell
winget install --id Microsoft.PowerShell --source winget
```

### SharePoint Online Management Shell

```powershell
# Je modul nainstalovaný?
Get-Module -Name Microsoft.Online.SharePoint.PowerShell -ListAvailable | Select Name, Version

# Instalace
Install-Module -Name Microsoft.Online.SharePoint.PowerShell

# Aktualizace
Update-Module -Name Microsoft.Online.SharePoint.PowerShell
```

Připojení k tenantu:

```powershell
# Bez MFA (jméno + heslo)
Connect-SPOService -Url https://contoso-admin.sharepoint.com -Credential admin@contoso.com

# S MFA (otevře přihlašovací okno)
Connect-SPOService -Url https://contoso-admin.sharepoint.com
```

Přehled cmdletů a nápověda:

```powershell
Get-Command *SPO*
Get-Help Connect-SPOService -examples
```

### SharePoint PnP PowerShell

```powershell
# Starší verze (Windows PowerShell 5.1)
Install-Module SharePointPnPPowerShellOnline -AllowClobber

# Novější verze (vyžaduje PowerShell 7)
winget install --id Microsoft.PowerShell --source winget
Install-Module PnP.PowerShell

# Aktualizace / odinstalace starší verze
Update-Module SharePointPnPPowerShellOnline
Uninstall-Module SharePointPnPPowerShellOnline -AllVersions -Confirm:$False
```

Přehled cmdletů a nápověda:

```powershell
Get-Command *PnP*
Get-Help Get-PnPFile -examples
```

Kompletní seznam cmdletů: <https://pnp.github.io/powershell/cmdlets/index.html>

Od PnP.PowerShell (verze pro PS 7) je potřeba **vlastní Entra ID app registrace** (shared „PnP Management Shell" app už neexistuje):

```powershell
Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "PnP.PowerShell" -Tenant contoso.onmicrosoft.com
```

Připojení:

```powershell
Connect-PnPOnline contoso.sharepoint.com -Interactive -ClientId <client id vaší Entra ID app registrace>
```

## Vybrané příklady užití

### Získání informací o webu

```powershell
Get-SPOSite

$site = Get-SPOSite https://contoso.sharepoint.com/sites/PMO
$site | Get-Member
$site.LastContentModifiedDate
```

### Výpis detailů o tenantu

```powershell
Get-SPOTenant
```

### Přehled využití úložiště per web

```powershell
Get-SPOSite -Limit All |
  Select Url, StorageUsageCurrent, StorageQuota,
    @{ Name = '% Used'; Expression = { '{0:P2}' -f ($_.StorageUsageCurrent / $_.StorageQuota) } } |
  Sort-Object StorageUsageCurrent -Descending
```

`-Limit All` vrátí všechny weby (i tisíce). Skript vybere URL, aktuální využití a kvótu a přidá vlastní vlastnost **% Used** (podíl využití ku kvótě, formátovaný jako procento se dvěma desetinnými místy `{0:P2}`). Nakonec řadí sestupně podle využití – nejvytíženější weby jsou první.

### Celkové dostupné a alokované místo v tenantu

```powershell
# Detaily o úložišti tenantu
$storageInfo = Get-PnPTenant

$totalStorage     = [math]::round($storageInfo.StorageQuota / 1TB, 2)
$usedStorage      = [math]::round($storageInfo.StorageQuotaUsed / 1TB, 2)
$availableStorage = [math]::round(($storageInfo.StorageQuota - $storageInfo.StorageQuotaUsed) / 1TB, 2)

Write-Host "Celková velikost alokovaného místa: $totalStorage TB"
Write-Host "Použité místo: $usedStorage TB"
Write-Host "Dostupné místo: $availableStorage TB"
```

### Celkové místo, které alokují weby v koši

```powershell
# Weby v koši
$sites = Get-PnPTenantSite -IncludeOnlyRecycleBinSites $true

$totalDeletedSize = 0
foreach ($site in $sites) {
    $totalDeletedSize += $site.StorageUsage
}

$totalDeletedSizeMB = [math]::round($totalDeletedSize / 1024, 2)
Write-Host "Celková velikost místa webů v koši: $totalDeletedSizeMB MB"
```

### Výpis externích uživatelů (guestů) ze všech webů

```powershell
$sites = Get-SPOSite -Limit ALL | Where {
    $_.Template -ne "REDIRECTSITE#0" -and $_.Template -ne "SPSMSITEHOST#0" -and
    $_.Template -ne "POINTPUBLISHINGPERSONAL#0" -and $_.Template -ne "POINTPUBLISHINGHUB#0"
}

foreach ($site in $sites) {
    Try {
        Write-Host -NoNewline "Checking for guests on " $site.Url
        $Guests = Get-SPOUser -Limit All -Site $site.Url |
            Where { $_.LoginName -like "*urn:spo:guest*" -or $_.LoginName -like "*#ext#*" } |
            Select DisplayName, LoginName, @{ Name = "Url"; Expression = { $site.Url } }
        $ExternalUsers += $Guests

        if ($Guests) { Write-Host -ForegroundColor Green "  Found Guests on this site" }
        else         { Write-Host -ForegroundColor Magenta " No Guests Found on this site" }
    }
    Catch {
        Write-Host -ForegroundColor Red " Change failed on" $site.Url ". This can be because the site is locked or is using a template that does not support it"
    }
    $Guests = $null
}

$ExternalUsers
```

### Výpis „redirect" webů

```powershell
Get-SPOSite -Template RedirectSite#0 |
  Select Url, @{ Name = 'Redirects to'; Expression = { (Invoke-WebRequest -Uri $_.Url -MaximumRedirection 0).Headers.Location } }
```

### Nastavení Site Owners pro všechny weby

```powershell
# Weby v tenantu (bez OneDrive)
$sites = Get-PnPTenantSite -IncludeOneDriveSites $false

# Uživatelé, které chcete nastavit jako vlastníky
$owners = "user1@domain.com", "user2@domain.com"

foreach ($site in $sites) {
    Set-PnPTenantSite -Url $site.Url -Owners $owners
    Write-Host "Nastaveni noví vlastníci na webu $($site.Url)"
}
```

### Identifikace duplicitního obsahu (podle MD5 hashe)

```powershell
# Parametry
$SiteURL      = "https://contoso.sharepoint.com/sites/YourSite"
$Pagesize     = 2000
$ReportOutput = "C:\Temp\Duplicates.csv"

Connect-PnPOnline $SiteURL -Interactive

$DataCollection = @()

# Všechny knihovny dokumentů (kromě systémových)
$DocumentLibraries = Get-PnPList | Where-Object {
    $_.BaseType -eq "DocumentLibrary" -and $_.Hidden -eq $false -and $_.ItemCount -gt 0 -and
    $_.Title -Notin ("Site Pages", "Style Library", "Preservation Hold Library")
}

ForEach ($Library in $DocumentLibraries) {
    $global:counter = 0
    $Documents = Get-PnPListItem -List $Library -PageSize $Pagesize -Fields ID, File_x0020_Type -ScriptBlock `
        { Param($items) $global:counter += $items.Count; Write-Progress -PercentComplete ($global:Counter / ($Library.ItemCount) * 100) `
            -Activity "Getting Documents from Library '$($Library.Title)'" -Status "Getting Documents data $global:Counter of $($Library.ItemCount)"; } |
        Where { $_.FileSystemObjectType -eq "File" }

    Foreach ($Document in $Documents) {
        $File = Get-PnPProperty -ClientObject $Document -Property File

        # Hash obsahu souboru
        $Bytes = $File.OpenBinaryStream()
        Invoke-PnPQuery
        $MD5 = New-Object -TypeName System.Security.Cryptography.MD5CryptoServiceProvider
        $HashCode = [System.BitConverter]::ToString($MD5.ComputeHash($Bytes.Value))

        $Data = New-Object PSObject
        $Data | Add-Member -MemberType NoteProperty -Name "FileName" -Value $File.Name
        $Data | Add-Member -MemberType NoteProperty -Name "HashCode" -Value $HashCode
        $Data | Add-Member -MemberType NoteProperty -Name "URL" -Value $File.ServerRelativeUrl
        $Data | Add-Member -MemberType NoteProperty -Name "FileSize" -Value $File.Length
        $DataCollection += $Data
    }
}

# Duplicity = stejný hash u více souborů
$Duplicates = $DataCollection | Group-Object -Property HashCode | Where { $_.Count -gt 1 } | Select -ExpandProperty Group
Write-Host "Duplicate Files Based on File Hashcode:"
$Duplicates | Format-Table -AutoSize
$Duplicates | Export-Csv -Path $ReportOutput -NoTypeInformation
```

### Identifikace obsahu s cestou delší než 400 znaků

SharePoint má limit délky URL; příliš dlouhé cesty způsobují problémy. Tento skript projde weby a knihovny a najde položky přesahující limit:

```powershell
# Parametry
$SiteURL      = "https://contoso.sharepoint.com/sites/Marketing"
$MaxUrlLength = 400
$CSVPath      = "C:\Temp\LongURLInventory.csv"
$global:LongURLInventory = @()
$Pagesize     = 2000

Function Get-PnPLongURLInventory {
    [cmdletbinding()]
    param([parameter(Mandatory = $true, ValueFromPipeline = $true)] $Web)

    Write-Host "Scanning Files with Long URL in Site '$($Web.URL)'" -f Yellow
    If ($Web.ServerRelativeUrl -eq "/") { $TenantURL = $Web.Url }
    Else { $TenantURL = $Web.Url.Replace($Web.ServerRelativeUrl, '') }

    $ExcludedLists = @("Form Templates", "Preservation Hold Library", "Site Assets", "Pages", "Site Pages",
        "Images", "Site Collection Documents", "Site Collection Images", "Style Library")

    $Lists = Get-PnPProperty -ClientObject $Web -Property Lists
    $Lists | Where-Object { $_.BaseType -eq "DocumentLibrary" -and $_.Hidden -eq $false -and $_.Title -notin $ExcludedLists -and $_.ItemCount -gt 0 } -PipelineVariable List | ForEach-Object {
        $global:counter = 0
        $ListItems = Get-PnPListItem -List $_ -PageSize $Pagesize -Fields Author, Created, File_x0020_Type -ScriptBlock { Param($items) $global:counter += $items.Count; Write-Progress -PercentComplete ($global:Counter / ($_.ItemCount) * 100) -Activity "Getting List Items of '$($_.Title)'" -Status "Processing Items $global:Counter to $($_.ItemCount)"; }
        $LongListItems = $ListItems | Where { ([uri]::EscapeUriString($_.FieldValues.FileRef).Length + $TenantURL.Length) -gt $MaxUrlLength }

        If ($LongListItems.count -gt 0) {
            $Folder = Get-PnPProperty -ClientObject $_ -Property RootFolder
            Write-Host "`tFound '$($LongListItems.count)' Items with Long URLs at '$($Folder.ServerRelativeURL)'" -f Green

            ForEach ($ListItem in $LongListItems) {
                $AbsoluteURL = "$TenantURL$($ListItem.FieldValues.FileRef)"
                $EncodedURL = [uri]::EscapeUriString($AbsoluteURL)

                $global:LongURLInventory += New-Object PSObject -Property ([ordered]@{
                    SiteName        = $Web.Title
                    SiteURL         = $Web.URL
                    LibraryName     = $List.Title
                    LibraryURL      = $Folder.ServerRelativeURL
                    ItemName        = $ListItem.FieldValues.FileLeafRef
                    Type            = $ListItem.FileSystemObjectType
                    FileType        = $ListItem.FieldValues.File_x0020_Type
                    AbsoluteURL     = $AbsoluteURL
                    EncodedURL      = $EncodedURL
                    UrlLength       = $EncodedURL.Length
                    CreatedBy       = $ListItem.FieldValues.Author.LookupValue
                    CreatedByEmail  = $ListItem.FieldValues.Author.Email
                    CreatedAt       = $ListItem.FieldValues.Created
                    ModifiedBy      = $ListItem.FieldValues.Editor.LookupValue
                    ModifiedByEmail = $ListItem.FieldValues.Editor.Email
                    ModifiedAt      = $ListItem.FieldValues.Modified
                })
            }
        }
    }
}

Connect-PnPOnline -Url $SiteURL -Interactive
Get-PnPSubWeb -Recurse -IncludeRootWeb | ForEach-Object { Get-PnPLongURLInventory $_ }
$Global:LongURLInventory | Export-Csv $CSVPath -NoTypeInformation
Write-Host "Report has been Exported to '$CSVPath'" -f Magenta
```

## Výpis všech podřízených webů v rámci webu

```powershell
$SiteURL = "https://contoso.sharepoint.com/sites/marketing"
Get-PnPSubWeb
```

## PnP Site Provisioning

„Živé" vzorové weby lze exportovat jako šablonu a aplikovat na cílové weby:

```powershell
# Získání definice ze zdrojového webu
Connect-PnPOnline -Url "https://contoso.sharepoint.com/sites/sourcesite"
Get-PnPSiteTemplate -Out "c:\Site-Definition-File.xml"

# Aplikace definice na cílový web
Invoke-PnPSiteTemplate -Path "c:\Site-Definition-File.xml" -Url https://contoso.sharepoint.com/sites/targetsite
```

Reference: [Get-PnPSiteTemplate](https://pnp.github.io/powershell/cmdlets/Get-PnPSiteTemplate.html)

## Nastavit seznam / knihovnu jako skrytou

```powershell
$SiteURL  = "https://contoso.sharepoint.com/Sales"
$ListName = "AppConfig"

Connect-PnPOnline -Url $SiteURL -Interactive
Set-PnPList -Identity $ListName -Hidden $True
```

## Další příklady skriptů

Rozsáhlá komunitní knihovna hotových PnP skriptů: <https://pnp.github.io/script-samples/>

---

*Součást kurzu [„Microsoft SharePoint Online – administrace od A do Z"](README.md). Vede [Kamil Juřík](https://www.linkedin.com/in/kamiljurik/) · [okskoleni.cz/kurzy/detail/MSHP-ONLINE](https://www.okskoleni.cz/kurzy/detail/MSHP-ONLINE)*
