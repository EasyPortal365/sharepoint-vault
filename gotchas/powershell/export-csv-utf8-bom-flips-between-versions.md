---
title: "`Export-Csv -Encoding UTF8` flips the BOM between 5.1 and 7"
tags: [powershell, reporting, encoding]
applies-to: Windows PowerShell 5.1 vs PowerShell 7.x
last-reviewed: 2026-07-29
---

# `Export-Csv -Encoding UTF8` flips the BOM between 5.1 and 7

> **Bottom line.** The identical `-Encoding UTF8` writes a byte order mark under Windows PowerShell 5.1 and omits it under PowerShell 7 — and Excel on Windows decides a CSV's encoding from that BOM, so the same reporting script produces a readable file on one machine and `PrÃ¡vnÃ­ oddÄ›lenÃ­` on the next.
>
> **Ve zkratce.** Naprosto stejné `-Encoding UTF8` zapíše ve Windows PowerShellu 5.1 BOM a v PowerShellu 7 ho vynechá – a Excel na Windows určuje kódování CSV právě podle BOM, takže tentýž reportovací skript vyrobí na jednom stroji čitelný soubor a na druhém `PrÃ¡vnÃ­ oddÄ›lenÃ­`.

## Symptom

A SharePoint inventory script exports site titles, library names and user display names. On your machine the CSV opens perfectly in Excel. A colleague runs the identical script and every non-ASCII character is mangled:

```text
Právní oddělení    ->    PrÃ¡vnÃ­ oddÄ›lenÃ­
Šimková, Tomáš     ->    Å imkovÃ¡, TomÃ¡Å¡
```

Nothing in the script changed. Nothing in the tenant changed. Notepad and VS Code both show the file as correct, which sends you looking for a SharePoint encoding problem that does not exist.

## Cause

`-Encoding UTF8` does not mean the same thing in both engines. Measured on one Windows 11 machine, same script, same parameter:

```text
PS 5.1.26100  first bytes: EF BB BF   BOM = True
PS 7.6.3      first bytes: 22 4E 61   BOM = False
```

PowerShell 6 changed the platform-wide default to UTF-8 **without** BOM — the right call for cross-platform tooling, and the wrong one for Excel on Windows. Excel does not sniff UTF-8: given a BOM-less file it falls back to the system ANSI code page (1250 in Central Europe, 1252 in the West) and renders each UTF-8 byte pair as two characters. Text editors, which do sniff, show the file as fine — so the tool you verify with disagrees with the tool your reader uses.

The double-click path is the one that breaks. Excel's *Data → From Text/CSV* import lets you pick UTF-8 by hand and works either way, which is why this survives so long: whoever built the report imports it properly, and everyone who receives it double-clicks.

## Fix

If the CSV is for humans with Excel, write the BOM explicitly. On PowerShell 6+ there is a dedicated value:

```powershell
$report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8BOM   # PS 6+ only
```

`UTF8BOM` does not exist on 5.1 (`Cannot validate argument on parameter 'Encoding'`), so a script that must run on both needs a version-agnostic export:

```powershell
function Export-CsvForExcel {
    param($InputObject, [string]$Path)

    $csv = $InputObject | ConvertTo-Csv -NoTypeInformation
    # UTF8Encoding($true) = emit BOM, on every PowerShell version
    [System.IO.File]::WriteAllLines($Path, $csv, (New-Object System.Text.UTF8Encoding($true)))
}

Export-CsvForExcel -InputObject $report -Path .\inventory.csv
```

Or branch on the engine when you want to keep `Export-Csv`:

```powershell
$enc = if ($PSVersionTable.PSVersion.Major -ge 6) { 'UTF8BOM' } else { 'UTF8' }
$report | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding $enc
```

Verify by bytes, never by eye — a text editor will lie to you here:

```powershell
$b = [System.IO.File]::ReadAllBytes($OutputPath)
'BOM = {0}' -f [bool]($b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
```

## Notes

- The BOM is what makes it work, not the encoding: both files *are* valid UTF-8. This is purely about Excel being told which it is.
- Delimiter is a separate, compounding trap on localized Windows: Excel expects the list separator from regional settings (`;` in most of Central Europe), while `Export-Csv` writes `,` unless you pass `-Delimiter` or `-UseCulture`. A file can be perfectly encoded and still land in a single column.
- The scripts in this vault use plain `-Encoding UTF8`, which is correct under 5.1 and BOM-less under 7 — if you run them on 7 and hand the CSV to somebody, apply the fix above.
- Mirror image, for reading: [PS 5.1 `Get-Content` mangles UTF-8](get-content-mangles-utf8.md).
- The other place where "works on my engine" hides a defect: [A syntax check under PowerShell 7 proves nothing about 5.1](ps7-parse-check-misses-ps51-syntax-errors.md).
