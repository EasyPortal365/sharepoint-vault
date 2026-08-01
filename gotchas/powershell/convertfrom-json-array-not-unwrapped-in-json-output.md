---
title: "PS 5.1: @(pipeline ConvertFrom-Json) keeps the array wrapped — and ConvertTo-Json emits {value:[…],Count:n} garbage"
tags: [powershell, ps51, convertfrom-json, convertto-json, arrays, json]
applies-to: Windows PowerShell 5.1 (PowerShell 7 behaves sanely)
last-reviewed: 2026-08-01
---

# PS 5.1: `@(pipeline ConvertFrom-Json)` keeps the array wrapped — and `ConvertTo-Json` emits `{value:[…],Count:n}` garbage

> **Bottom line.** In Windows PowerShell 5.1, `ConvertFrom-Json` returns a JSON array as a *PSObject-wrapped* array. Wrapping the **pipeline** in `@(...)` does not enumerate it — you get an array whose single element is the whole inner array. Concatenating (`@($newItem) + $parsed`) then nests that array as one item, and `ConvertTo-Json` happily serializes the wrapper as `{"value":[…],"Count":1}`. Enumerate explicitly (`$parsed | ForEach-Object { $_ }`) and filter for the shape you expect before writing anything back.
>
> **Ve zkratce.** Ve Windows PowerShellu 5.1 vrací `ConvertFrom-Json` pole obalené v PSObjectu. `@(...)` KOLEM PIPELINE ho neenumeruje — vznikne pole, jehož jediný prvek je celé vnitřní pole. Následné `@($novy) + $parsed` pak vnoří pole jako jeden prvek a `ConvertTo-Json` vypíše `{"value":[…],"Count":1}`. Enumeruj explicitně (`$parsed | ForEach-Object { $_ }`) a před zápisem filtruj na očekávaný tvar.

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

## Fix

```powershell
$parsed = Get-Content $file -Raw | ConvertFrom-Json
$releases = @($parsed | ForEach-Object { $_ } |
  Where-Object { $_.PSObject.Properties['version'] -and $_.version -match '^\d+(\.\d+){1,3}$' })
$releases = @([pscustomobject]@{ version = $v; date = $d }) + $releases
```

- `ForEach-Object { $_ }` forces enumeration of the wrapped array.
- The shape filter also heals files already poisoned by an earlier buggy run.
- Verify the **output file**, not the exit code — the buggy version exits 0 and prints a happy summary.
- Related single-item trap on the way out: `ConvertTo-Json` unwraps one-element arrays; wrap explicitly (`"[$json]"`) when the list has exactly one item.
