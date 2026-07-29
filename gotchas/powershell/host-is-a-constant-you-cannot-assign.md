---
title: "`$host` is a constant — and `[uri].Host` is exactly what you want to store in it"
tags: [powershell, scripting]
applies-to: Windows PowerShell 5.1, PowerShell 7.x
last-reviewed: 2026-07-29
---

# `$host` is a constant — and `[uri].Host` is exactly what you want to store in it

> **Bottom line.** Building a full file URL from a server-relative path invites `$host = ([uri]$web.Url).Host`, and PowerShell answers "Cannot overwrite variable Host because it is read-only or constant" — an error about your *variable name*, phrased as if something were wrong with the value.
>
> **Ve zkratce.** Skládání plné URL ze server-relativní cesty svádí napsat `$host = ([uri]$web.Url).Host` a PowerShell odpoví „Cannot overwrite variable Host because it is read-only or constant" – chyba o **názvu proměnné**, formulovaná, jako by byl problém v hodnotě.

## Symptom

A perfectly ordinary line in a SharePoint reporting script:

```powershell
$web  = Get-PnPWeb
$host = ([uri]$web.Url).GetLeftPart([System.UriPartial]::Authority)
$full = $host + $item['FileRef']
```

```text
Cannot overwrite variable Host because it is read-only or constant.
```

The value is a plain string. The cast is fine. The error mentions neither reserved names nor automatic variables, so the first instinct is to inspect `$web.Url`.

## Cause

`$Host` is an automatic variable holding the PowerShell host application, and it is declared `Constant, AllScope` — not merely read-only. Constant variables cannot be reassigned, cannot be removed, and cannot be shadowed by a local of the same name, which is why the error fires even inside a function.

The collision is not bad luck. `Host` is the natural name for the thing you get out of `[uri]`, `Uri.Host` is literally the property name, and half of building SharePoint URLs is separating host from path.

Automatic variables are not uniformly protected — checked on 5.1 and 7:

| Variable | Options | Assignable |
|---|---|---|
| `$host` | `Constant, AllScope` | no |
| `$error` | `Constant` | no |
| `$PID`, `$PSHome`, `$true` | `Constant, AllScope` | no |
| `$input` | `None` | yes — and clobbering it breaks pipeline functions |
| `$args` | `None` | yes — and clobbering it breaks parameter-less functions |
| `$profile` | `None` | yes |

So the ones that *bite loudly* are the safe ones. `$input` and `$args` accept the assignment silently and break something subtle later.

## Fix

Rename. Nothing else is available — the variable is a constant by design:

```powershell
$authority = ([uri]$web.Url).GetLeftPart([System.UriPartial]::Authority)
$full      = $authority + $item['FileRef']
```

Check a name before you commit to it across a script:

```powershell
(Get-Variable -Name host -ErrorAction SilentlyContinue).Options   # Constant, AllScope
```

## Notes

- PSScriptAnalyzer's `PSAvoidAssignmentToAutomaticVariable` flags this statically, including the silent `$input` / `$args` cases that PowerShell itself never complains about. Worth having in the lint step for exactly those two.
- `${host}` and `$script:host` do not get you around it; constant means constant in every scope.
- Other names worth avoiding in SharePoint scripts for the same reason: `$matches` (populated by every `-match` you run, so your value survives only until the next comparison) and `$error` (constant).
