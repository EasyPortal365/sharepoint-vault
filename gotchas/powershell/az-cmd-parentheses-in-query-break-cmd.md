---
title: Parentheses in an Azure CLI --query argument break az.cmd on Windows ("-o was unexpected at this time.")
short-title: "`--query \"length([?…])\"` from PowerShell kills `az.cmd`"
summary: "On Windows `az` is a batch file; a JMESPath query with `(` `)` and no spaces reaches cmd unquoted and breaks its IF block – return plain names and count in PowerShell"
tags: [powershell, azure-cli, windows, deployment]
applies-to: Azure CLI on Windows (az.cmd), Windows PowerShell 5.1 and PowerShell 7
last-reviewed: 2026-10-21
---

# Parentheses in an Azure CLI `--query` break `az.cmd` on Windows

> **Bottom line.** On Windows, `az` is a batch file (`az.cmd`). A JMESPath query such as `length([?name=='x'])` contains parentheses but no spaces, so PowerShell passes it unquoted and `cmd.exe` reads the `)` as the end of the batch file's `IF ( … )` block: the call dies with `-o was unexpected at this time.` Don't count in JMESPath – ask for plain names (`--query '[].name' -o tsv`) and count in PowerShell.
>
> **Ve zkratce.** Na Windows je `az` dávkový soubor (`az.cmd`). Dotaz JMESPath jako `length([?name=='x'])` má závorky, ale žádnou mezeru, takže ho PowerShell předá bez uvozovek a `cmd.exe` si `)` vyloží jako konec bloku `IF ( … )` v dávce: volání spadne s `-o was unexpected at this time.` Nepočítej v JMESPath – vyžádej si jen jména (`--query '[].name' -o tsv`) a spočítej je v PowerShellu.

## Symptom

A deployment script that runs fine on Linux / Cloud Shell fails on a Windows workstation at an existence check:

```powershell
$count = az cognitiveservices account list -g $rg --query ("length([?name=='" + $name + "'])") -o tsv
```

```
-o was unexpected at this time.
```

`$LASTEXITCODE` is non-zero and nothing reached Azure. Earlier `az` calls in the same script (with simple queries like `'location'`) worked.

## Cause

The MSI-installed `az.cmd` (source: `build_scripts/windows/scripts/az_msi.cmd` in the Azure/azure-cli repo) runs the CLI inside a parenthesised block:

```bat
@IF EXIST "%~dp0\..\python.exe" (
  SET AZ_INSTALLER=MSI
  "%~dp0\..\python.exe" -IBm azure.cli %*
) ELSE ( … )
```
 PowerShell quotes a native argument only when it contains whitespace, so `length([?name=='my-account'])` arrives in `%*` **unquoted**. When cmd expands `%*` inside the block, the `)` closes the `IF`, and the rest of the line (`-o tsv )`) is a syntax error.

Reproduce without Azure: a two-line batch file with `@IF EXIST "%~dp0x.cmd" ( echo %* )` fails the same way when called from PowerShell with that argument.

## Fix

Keep parentheses out of arguments to `az` and do the filtering in PowerShell:

```powershell
$names = @(az cognitiveservices account list -g $rg --query '[].name' -o tsv)
if ($LASTEXITCODE -ne 0) { throw 'Listing accounts failed.' }
$exists = @($names | Where-Object { ([string]$_).Trim() -eq $name }).Count -gt 0
```

`[]`, `.` and `'` are safe for cmd; `(`, `)`, `&`, `|`, `<`, `>` and `^` are not.

## Notes

- Help texts that merely *print* a JMESPath command for the user to copy are fine – only arguments actually passed to `az.cmd` matter.
- Quoting tricks (`'"length(...)"'`, `--%`) behave differently in Windows PowerShell 5.1 and in PowerShell 7 (`$PSNativeCommandArgumentPassing`); avoiding the characters is the version-proof fix.
- Any batch-file wrapper that expands `%*` inside an `IF ( … )` block has the same weakness – check the wrapper before passing such arguments.
