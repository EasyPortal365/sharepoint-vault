---
title: "PS 5.1: @(pipeline ConvertFrom-Json) keeps the array wrapped — foreach runs once, ConvertTo-Json emits {value:[…],Count:n} garbage"
short-title: "PS 5.1: `@(ConvertFrom-Json)` keeps the array wrapped"
summary: "`@()` around the pipeline doesn't enumerate: `foreach` over it runs ONCE with the whole array, and a later `+` nests the array so `ConvertTo-Json` writes `{value:[…],Count:n}` garbage; fix with `@((ConvertFrom-Json …))`"
tags: [powershell, ps51, convertfrom-json, convertto-json, arrays, json]
applies-to: Windows PowerShell 5.1 (PowerShell 7 behaves sanely)
last-reviewed: 2026-11-07
---

# PS 5.1: `@(pipeline ConvertFrom-Json)` keeps the array wrapped — and `ConvertTo-Json` emits `{value:[…],Count:n}` garbage

> **Bottom line.** In Windows PowerShell 5.1, `ConvertFrom-Json` returns a JSON array as a *PSObject-wrapped* array. Wrapping the **pipeline** in `@(...)` does not enumerate it — you get an array whose single element is the whole inner array. Concatenating (`@($newItem) + $parsed`) then nests that array as one item, and `ConvertTo-Json` happily serializes the wrapper as `{"value":[…],"Count":1}`. The same wrapping makes `foreach ($r in @(ConvertFrom-Json $json))` run **once**, with `$r` being the whole array. Enumerate explicitly — `@((ConvertFrom-Json $json))` (inner parentheses) or `$parsed | ForEach-Object { $_ }` — and filter for the shape you expect before writing anything back.
>
> **Ve zkratce.** Ve Windows PowerShellu 5.1 vrací `ConvertFrom-Json` pole obalené v PSObjectu. `@(...)` KOLEM PIPELINE ho neenumeruje – vznikne pole, jehož jediný prvek je celé vnitřní pole. Následné `@($novy) + $parsed` pak vnoří pole jako jeden prvek a `ConvertTo-Json` vypíše `{"value":[…],"Count":1}`. Stejné obalení způsobí, že `foreach ($r in @(ConvertFrom-Json $json))` proběhne **jednou** a `$r` je celé pole. Enumeruj explicitně – `@((ConvertFrom-Json $json))` (vnitřní závorka) nebo `$parsed | ForEach-Object { $_ }` – a před zápisem filtruj na očekávaný tvar.

## Symptom

A release-manifest updater kept a JSON list of versions. After the *second* run the file contained:

```json
[
  { "version": "1.4.1", "date": "2026-08-01" },
  { "value": [ { "version": "1.4.0", "date": "2026-08-01" } ], "Count": 1 }
]
```

Any consumer that validates items (as it should) silently drops the wrapped entry — the older version "disappears" from the UI and it looks like a frontend bug.

## Cause

```powershell
$releases = @(Get-Content $file -Raw | ConvertFrom-Json)   # ← looks safe, is not (PS 5.1)
$releases = @([pscustomobject]@{ version = $v; date = $d }) + $releases
$releases | ConvertTo-Json | Set-Content $file
```

`ConvertFrom-Json` (5.1) emits the array as one PSObject; `@(...)` around a pipeline that returned *one* object produces a one-element array containing the inner array. `+` then appends that inner array **as a single element**, and `ConvertTo-Json` serializes the enumerable wrapper as `{value, Count}`.

## Second symptom: `foreach` runs once

A generated script embeds its work list as JSON and loops over it:

```powershell
$Plan = @(ConvertFrom-Json $json)        # 2 sites in the JSON
foreach ($r in $Plan) { Set-SPOSite -Identity $r.Url ... }
```

In 5.1 the loop body runs **once**. `$r` is the whole array, so `$r.Url` (member enumeration) is an array of all URLs and the cmdlet fails — or, worse, a property you only *read* silently becomes `"value1 value2"` in your log. Plans with a single row work, so tests with one item pass. A parse check (`[System.Management.Automation.Language.Parser]::ParseFile`) passes too.

Measured in Windows PowerShell 5.1 and PowerShell 7 for `[]`, 1, 2 and 3 items:

| Expression | 5.1 `.Count` | 7 `.Count` |
|---|---|---|
| `@(ConvertFrom-Json $j)` | always 1 | 0 / 1 / 2 / 3 |
| `@((ConvertFrom-Json $j))` | 0 / 1 / 2 / 3 | 0 / 1 / 2 / 3 |

## Fix

```powershell
$parsed = Get-Content $file -Raw | ConvertFrom-Json
$releases = @($parsed | ForEach-Object { $_ } |
  Where-Object { $_.PSObject.Properties['version'] -and $_.version -match '^\d+(\.\d+){1,3}$' })
$releases = @([pscustomobject]@{ version = $v; date = $d }) + $releases
```

- `ForEach-Object { $_ }` forces enumeration of the wrapped array; for a list you only loop over, `@((ConvertFrom-Json $json))` is the shortest form that is correct in both 5.1 and 7.
- Test a generated script by **running** it in the target PowerShell version, with functions named like the cmdlets it calls (`function Get-SPOSite { ... }` with in-memory state — functions win over cmdlets, the module is never loaded), and a plan with more than one row.
- The shape filter also heals files already poisoned by an earlier buggy run.
- Verify the **output file**, not the exit code — the buggy version exits 0 and prints a happy summary.
- Related single-item trap on the way out: `ConvertTo-Json` unwraps one-element arrays; wrap explicitly (`"[$json]"`) when the list has exactly one item.
