---
title: Windows PowerShell 5.1 Get-Content/Set-Content mangles UTF-8 — á becomes Ã¡
tags: [powershell, encoding, tooling]
applies-to: Windows PowerShell 5.1 (PowerShell 7 behaves)
last-reviewed: 2026-07-29
---

# Windows PowerShell 5.1 `Get-Content`/`Set-Content` mangles UTF-8 — `á` becomes `Ã¡`

> **Bottom line.** Windows PowerShell 5.1 reads files as ANSI and writes UTF-8 with a BOM, corrupting diacritics — go through .NET `[System.IO.File]::ReadAllText/WriteAllText` with an explicit BOM-less `UTF8Encoding($false)` instead.
>
> **Ve zkratce.** Windows PowerShell 5.1 čte soubory jako ANSI a zapisuje UTF-8 s BOM, čímž rozbije diakritiku – místo toho jdi přes .NET `[System.IO.File]::ReadAllText/WriteAllText` s explicitním `UTF8Encoding($false)` bez BOM.

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

## The louder failure: non-ASCII in the *pattern*

Corruption is the quiet outcome. When the **search pattern itself** carries diacritics, the run can fail outright instead:

```powershell
$t = Get-Content $f -Raw
$t = $t -replace "'Správa homepage'", "'Správa aplikace'"   # matches nothing
Set-Content $f -Value $t -NoNewline
```

The pattern is decoded through the console codepage, the file through another — so `-replace` finds nothing, and a follow-up `Select-String` in the same script can throw, leaving the run at **exit 1 with no output about what was written**.

Two habits make this survivable:

- **Prefer `.Replace()` over `-replace`** for literal swaps. It is an ordinary .NET string method, so there is no regex engine and no pattern parsing — one less layer to mis-decode. Keep `-creplace` (case-sensitive) for genuine regex work.
- **After a script dies mid-run, check `git status` before anything else.** A partially completed loop may have already rewritten some files in the wrong encoding. Only the diff tells you whether you have a clean tree or half-written files — the exit code does not.

## Verify both directions, plus the diacritics

A bulk rename is not verified by "the old string is gone". Check all three:

```bash
grep -c "OldName" file    # must be 0
grep -c "NewName" file    # must be > 0
grep -c "ě\|š\|č\|ř\|ž" file   # must still be > 0 for a Czech/Polish/Turkish file
```

The third line is the one that catches encoding damage — the rename can succeed while every accented character in the rest of the file gets mangled.

## Protecting identifiers during a rename

When a *display name* changes but technical identifiers must not, separate them with a negative lookahead instead of a second pass:

```powershell
# renames the product name but leaves console prefixes "[Old Name]" alone
$out = $raw -creplace 'Old Name(?!\])', 'New Name'
```

Then count the identifiers that had to survive (list titles, app ids, package names) and assert the number is unchanged. A rename that quietly renamed an app id is far more expensive than one that missed a label.

## Notes

- If a run already corrupted files: **restore from git and redo with the correct pattern.** Character-by-character "repair" via codepage round-trips destroys additional characters (the C1 range — `™` and friends — doesn't survive), we've tried so you don't have to.
- This applies to *any* text your 5.1 scripts touch — CSV exports for Excel are the one case where a BOM actually helps (Excel then detects UTF-8), so choose the encoding per audience, just always **choose** it.
