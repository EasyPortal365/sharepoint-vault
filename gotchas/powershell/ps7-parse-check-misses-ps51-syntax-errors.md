---
title: A syntax check under PowerShell 7 proves nothing about 5.1
tags: [powershell, tooling, ci]
applies-to: Windows PowerShell 5.1 vs PowerShell 7.x
last-reviewed: 2026-07-29
---

# A syntax check under PowerShell 7 proves nothing about 5.1

> **Bottom line.** `Parser::ParseFile` reports zero errors for a script full of PowerShell 7-only syntax — ternary, `??`, `-Parallel` — that is a hard parse error under Windows PowerShell 5.1, which is still what runs on every server and in most scheduled tasks; if your script is supposed to run on 5.1, the check must run *in* 5.1.
>
> **Ve zkratce.** `Parser::ParseFile` ohlásí nula chyb i u skriptu plného syntaxe jen pro PowerShell 7 – ternární operátor, `??`, `-Parallel` – která je pro Windows PowerShell 5.1 tvrdá chyba parseru; a 5.1 pořád běží na serverech a ve většině naplánovaných úloh. Když má skript jet na 5.1, musí kontrola běžet **v** 5.1.

## Symptom

A batch syntax check over a folder of scripts comes back clean:

```text
Get-SiteCollectionInventory.ps1               OK
Get-ExternalSharingReport.ps1                 OK
```

The script then dies on the target machine, at parse time, before a single line executes:

```text
Unexpected token '?' in expression or statement.
```

Same file, same bytes. The offending line is unremarkable:

```powershell
$expiry = $site.OverrideTenantExpiration ? $site.ExpirationInDays : $tenant.Default
```

## Cause

The parser is a property of the engine that hosts it. `[System.Management.Automation.Language.Parser]` inside `pwsh` 7 accepts 7's grammar; the same class inside `powershell.exe` 5.1 accepts 5.1's. Verified side by side on one machine:

```text
--- pwsh 7 parse ---                OK - parses
--- Windows PowerShell 5.1 parse ---  Unexpected token '?' in expression or statement.
```

`#Requires -Version 7.0` does not help while authoring: it is enforced at *run* time by the engine that got there first, so it turns a parse error into a slightly clearer runtime error on the target — never into a warning on your machine.

The 7-only constructs that most often slip through, because they read like ordinary PowerShell:

| Construct | 5.1 |
|---|---|
| `$a ? $b : $c` (ternary) | parse error |
| `$a ?? $b`, `$a ??= $b` | parse error |
| `$a?.Property` | parse error |
| `ForEach-Object -Parallel` | runtime: parameter not found |
| `Get-Content -AsByteStream` | runtime: parameter not found |
| `&&` / `\|\|` pipeline chain operators | parse error |

Note the split: the first group fails at parse time (the whole file is dead), the second at runtime (the file runs until it gets there — arguably worse, because half your changes already happened).

## Fix

Run the parse check inside the oldest engine you support. On Windows that is one extra process:

```powershell
# Parse-check every script under Windows PowerShell 5.1, from anywhere
Get-ChildItem .\scripts -Recurse -Filter *.ps1 | ForEach-Object {
    $f = $_.FullName
    $out = powershell.exe -NoProfile -Command @"
`$e = `$null
[void][System.Management.Automation.Language.Parser]::ParseFile('$f', [ref]`$null, [ref]`$e)
if (`$e) { `$e | ForEach-Object { 'line ' + `$_.Extent.StartLineNumber + ': ' + `$_.Message } } else { 'OK' }
"@
    '{0,-45} {1}' -f $_.Name, ($out -join '; ')
}
```

If you cannot spawn 5.1 (Linux build agent, container), PSScriptAnalyzer can approximate it:

```powershell
Invoke-ScriptAnalyzer -Path .\scripts -Recurse `
    -IncludeRule PSUseCompatibleSyntax `
    -Settings @{ Rules = @{ PSUseCompatibleSyntax = @{ Enable = $true; TargetVersions = @('5.1') } } }
```

It catches the grammar cases reliably and the parameter cases only if you also enable `PSUseCompatibleCommands` with a 5.1 platform profile.

## Notes

- The failure mode is asymmetric and that is what makes it dangerous: authoring happens in 7 (nicer console, better tooling), execution happens in 5.1 (whatever is on the server). You will never get a warning from the direction you are working in.
- Windows 11 26100 still ships 5.1 as `powershell.exe` and it remains the default for Task Scheduler entries created before pwsh was installed, for `Enter-PSSession` into older servers, and for anything launched by SCCM or a GPO startup script.
- The same asymmetry shows up in file encoding, in the opposite direction: [Export-Csv -Encoding UTF8 flips BOM between versions](export-csv-utf8-bom-flips-between-versions.md).
- Related, for reading rather than writing: [PS 5.1 `Get-Content` mangles UTF-8](get-content-mangles-utf8.md).
