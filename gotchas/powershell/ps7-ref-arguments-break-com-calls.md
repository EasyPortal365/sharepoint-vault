---
title: "PowerShell 7 `[ref]` arguments break Office COM calls"
tags: [powershell, com, office-automation]
applies-to: PowerShell 7.x on Windows (Word/Excel/PowerPoint COM)
last-reviewed: 2026-07-26
---

# PowerShell 7 `[ref]` arguments break Office COM calls

> **Bottom line.** In PowerShell 7 a `[ref]`-wrapped argument reaches the COM binder as a `PSObject` it cannot convert, so VBA-style calls like `$doc.SaveAs2([ref]$path, [ref]$format)` die with "Cannot convert … type psobject to type Object" — pass the values directly (`$doc.SaveAs2($path, $format)`); Office COM methods take them positionally just fine.
>
> **Ve zkratce.** V PowerShellu 7 dorazí argument zabalený do `[ref]` do COM binderu jako `PSObject`, který neumí převést, takže volání ve stylu VBA `$doc.SaveAs2([ref]$path, [ref]$format)` spadne na „Cannot convert … type psobject to type Object" – předávej hodnoty přímo (`$doc.SaveAs2($path, $format)`); pozičně je COM metody Office berou bez problému.

## Symptom

Automating Word from PowerShell 7, with the `[ref]` pattern that decades of VBA-derived examples (and Windows PowerShell 5.1 experience) suggest:

```powershell
$word = New-Object -ComObject Word.Application
$doc  = $word.Documents.Add()
$doc.SaveAs2([ref]$file, [ref]$format)
```

```text
Exception setting "SaveAs2": Cannot convert the "C:\out\Document.docx" value of
type "psobject" to type "Object".
```

The message names your *string* but claims it is a `psobject` — which is the actual clue.

## Cause

Office COM methods declare parameters as `ref object`, which is why old samples wrap everything in `[ref]`. PowerShell 7's COM interop wraps the referenced value in a `PSObject` on the way to the binder, and the conversion to the raw `object` the method expects fails. Windows PowerShell 5.1 marshalled the same pattern without complaint, so scripts break precisely when migrated to PS 7.

## Fix

Drop the `[ref]` and pass plain values positionally:

```powershell
$doc.SaveAs2($file, 16)     # 16 = wdFormatDocumentDefault, 17 = wdFormatPDF
$wb.SaveAs($file, 51)       # 51 = xlOpenXMLWorkbook
$pres.SaveAs($file, 24)     # 24 = ppSaveAsOpenXMLPresentation
```

The interop layer handles the by-ref plumbing itself; you only ever needed `[ref]` for parameters whose *output* you read back.

## Notes

- Use numeric constants (`-2` = `wdStyleHeading1` etc.) instead of localized style *names* — one more habit from English-only samples that breaks on non-English Office.
- Release COM objects (`[Runtime.InteropServices.Marshal]::ReleaseComObject`) and `Quit()` in a `finally`, or orphaned `WINWORD.EXE` processes accumulate behind failed runs.
