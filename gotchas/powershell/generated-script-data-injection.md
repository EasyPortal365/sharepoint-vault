---
title: A generated PowerShell script that embeds file names in a here-string runs code under the admin who runs it
short-title: "File names in a generated `@\" \"@` here-string run as code"
summary: Data that tenant users can name (file paths, titles) breaks every textual PowerShell literal – expandable here-strings run `$(…)`, `;` splits CSV rows, `'@` ends a literal here-string; embed data as base64 JSON instead
tags: [powershell, security, pnp]
applies-to: Any web app or tool that generates a .ps1 for an administrator (PnP.PowerShell, SPO Management Shell)
last-reviewed: 2026-10-30
---

# A generated PowerShell script that embeds file names in a here-string runs code under the admin who runs it

> **Bottom line.** Never put tenant data into a generated script as text. A file named `x$(Remove-Item -Recurse $HOME).docx` inside `$Data = @" … "@` runs when the variable is assigned, under the administrator's account. Embed the data as base64 JSON and decode it in the script.
>
> **Ve zkratce.** Data z tenantu nikdy nevkládej do generovaného skriptu jako text. Soubor `x$(Remove-Item -Recurse $HOME).docx` uvnitř `$Data = @" … "@` se spustí už při přiřazení proměnné, pod účtem správce. Data vlož jako base64 JSON a ve skriptu je dekóduj.

## Symptom

A web tool builds a script for the admin to run locally — a content transfer, a version
cleanup, a sharing fix for sites the tool can't write to. The rows go in as CSV:

```powershell
$Data = @"
SiteUrl;FileRef;VersionId
https://contoso.sharepoint.com/sites/a;/sites/a/Shared Documents/report.docx;512
"@
$Rows = $Data | ConvertFrom-Csv -Delimiter ";"
```

It works in every test. Then:

- a file called `x$(Remove-Item -Recurse $HOME).docx` executes the command the moment the admin runs the script — before anything connects to SharePoint;
- `Invoice $500.pdf` silently becomes `Invoice .pdf`;
- `a;512;1.0.docx` (SharePoint allows `;` in names) shifts the columns, so the script acts on **another file** — for a version cleanup with `DeleteByID`, permanently;
- switching to a literal here-string `@' … '@` doesn't save you: a line starting with `'@` ends it and the rest of the line runs.

Anyone with Contribute on a scanned library can name a file. When the script targets sites the admin *can't* manage, the attacker is exactly the owner of such a site.

## Cause

Every textual literal in PowerShell has an escape:

| Literal | Ends or expands on |
|---|---|
| `"…"`, `@"…"@` | `$var`, `$(…)`, backtick |
| `'…'` | `'` — and also `‘ ’ ‚ ‛` (PowerShell treats them as single quotes) |
| `@'…'@` | a line starting with `'@` |
| `<# … #>` | `#>` |
| CSV via `ConvertFrom-Csv` | the delimiter inside a value |

## Fix

Encode the rows as JSON, then base64 — the alphabet `[A-Za-z0-9+/=]` can't end a single-quoted string:

```powershell
$Rows = @(ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString(
  [System.Convert]::FromBase64String('W3siU2l0ZVVybCI6Imh0dHBzOi8v...'))))
```

```js
// UTF-8 → base64 in the browser (or use TextEncoder + btoa)
const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(rows))));
const line = "$Rows = @(ConvertFrom-Json ([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + b64 + "'))))";
```

- `@(…)` keeps an array even for zero or one row in Windows PowerShell 5.1.
- JSON carries arrays and numbers as they are, so you no longer need a second separator for lists.
- The whole script becomes ASCII, which also sidesteps Windows PowerShell 5.1 reading UTF-8 without BOM as the ANSI code page.
- Single values that must stay inline: wrap in `'…'` and double every `'`, `‘`, `’`, `‚`, `‛`. Values inside a `<# … #>` header: break `#>` and `<#` and strip line breaks.
- Test with a hostile name (`$(…)`, `;`, `'@`, `#>`), not just with the shape of the output.

## See also

- [Smart quotes are string delimiters](smart-quotes-are-string-delimiters.md)
- [Export-Csv UTF-8 BOM flips between versions](export-csv-utf8-bom-flips-between-versions.md)
