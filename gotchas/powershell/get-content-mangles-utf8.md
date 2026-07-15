---
title: Windows PowerShell 5.1 Get-Content/Set-Content mangles UTF-8 — á becomes Ã¡
tags: [powershell, encoding, tooling]
applies-to: Windows PowerShell 5.1 (PowerShell 7 behaves)
last-reviewed: 2026-07-16
---

# Windows PowerShell 5.1 `Get-Content`/`Set-Content` mangles UTF-8 — `á` becomes `Ã¡`

## Symptom

A bulk find-and-replace over source files (SPFx resources, localized strings, markdown):

```powershell
(Get-Content $file) -replace $old, $new | Set-Content $file
```

After the run, every non-ASCII character is corrupted — `á` → `Ã¡`, `ž` → `Å¾`, `ř` → `Å™` — and the files have picked up a BOM. Builds fail or, worse, garbled strings ship.

## Cause

Windows PowerShell 5.1 defaults are hostile to UTF-8:

- `Get-Content` without `-Encoding` reads files in the **ANSI codepage** (Windows-1252 on Western systems) — multi-byte UTF-8 sequences get reinterpreted as two Latin-1 characters each (the classic double-encoding).
- `Set-Content -Encoding UTF8` writes **UTF-8 with BOM**, which many toolchains dislike.

PowerShell 7 reads/writes BOM-less UTF-8 by default — the trap is specifically the 5.1 that still ships with Windows.

## Fix

Go through .NET directly, with an explicit BOM-less encoding:

```powershell
$utf8 = New-Object System.Text.UTF8Encoding($false)   # $false = no BOM
$text  = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)
$fixed = $text.Replace($old, $new)
[System.IO.File]::WriteAllText($file, $fixed, $utf8)
```

For files of unknown origin, read *strictly* so non-UTF-8 files are skipped instead of silently destroyed:

```powershell
try {
  $strict = New-Object System.Text.UTF8Encoding($false, $true)   # throw on invalid bytes
  $text = $strict.GetString([System.IO.File]::ReadAllBytes($file))
} catch { Write-Warning "skipping non-UTF-8 file: $file"; continue }
```

## Notes

- If a run already corrupted files: **restore from git and redo with the correct pattern.** Character-by-character "repair" via codepage round-trips destroys additional characters (the C1 range — `™` and friends — doesn't survive), we've tried so you don't have to.
- This applies to *any* text your 5.1 scripts touch — CSV exports for Excel are the one case where a BOM actually helps (Excel then detects UTF-8), so choose the encoding per audience, just always **choose** it.
