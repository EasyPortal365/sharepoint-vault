---
title: $ErrorActionPreference = 'Stop' turns a native command's stderr warning into a terminating error
tags: [powershell, azure-cli, error-handling]
applies-to: PowerShell 7 (and Windows PowerShell 5.1)
last-reviewed: 2026-07-19
---

# `$ErrorActionPreference = 'Stop'` turns a native command's stderr *warning* into a terminating error

> **Bottom line.** With `$ErrorActionPreference = 'Stop'`, anything a native command writes to stderr — even a benign warning, with a zero exit code — can become a terminating error and kill your script. Wrap such calls in `'Continue'` and judge success by `$LASTEXITCODE`, not by whether stderr was touched.
>
> **Ve zkratce.** Při `$ErrorActionPreference = 'Stop'` se cokoli, co nativní příkaz zapíše na stderr – i neškodné varování s nulovým exit kódem – může stát terminating chybou a shodit skript. Takové volání obal do `'Continue'` a úspěch posuzuj podle `$LASTEXITCODE`, ne podle toho, jestli se něco na stderr objevilo.

## Symptom

A fail-fast script sets `$ErrorActionPreference = 'Stop'` and calls the Azure CLI to (re)create an app secret:

```powershell
$ErrorActionPreference = 'Stop'
$cred = az ad app credential reset --id $appId --append | ConvertFrom-Json
```

The command **succeeds** — `$LASTEXITCODE` is `0`, the secret is created — yet the script dies right there. The Azure CLI printed a warning to stderr:

> WARNING: The output includes credentials that you must protect. Be sure that you do not include these credentials in your code ...

## Cause

`az ad app credential reset` — like many native CLIs (`az`, `git`, `npm`) — writes **warnings to stderr**, not stdout, and exits `0`. Under `$ErrorActionPreference = 'Stop'`, PowerShell escalates a native command's stderr output to a **terminating** error, so a routine warning aborts the script even though nothing actually failed. It looks like the command broke; it didn't.

## Fix

Around native calls that are allowed to write to stderr, drop the preference to `'Continue'` and decide success **solely** from `$LASTEXITCODE`:

```powershell
$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$out = az ad app credential reset --id $appId --append 2>&1
$ErrorActionPreference = $prev

if ($LASTEXITCODE -ne 0) {
    throw "az ad app credential reset failed ($LASTEXITCODE): $out"
}
```

Better still, drop the native command where a cmdlet exists. For an app secret, the Graph PowerShell SDK does it without the stderr-as-error hazard:

```powershell
$secret = Add-MgApplicationPassword -ApplicationId $appObjectId -PasswordCredential @{ displayName = 'automation' }
# $secret.SecretText is the value; $secret.KeyId lets you clean it up on a later failure.
```

## Notes

- The reliable success signal for a native command is **`$LASTEXITCODE`** (or `$?`), never the presence of stderr text — plenty of well-behaved tools use stderr for progress and warnings.
- Keep the `'Continue'` window as small as possible; restore the previous preference right after the call so the rest of your fail-fast script keeps its strictness.
- Cmdlets (`*-Mg*`, `*-PnP*`) raise real PowerShell errors that `'Stop'` handles correctly — this trap is specific to **native executables**.
