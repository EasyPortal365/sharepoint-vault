---
title: Word's PDF export silently substitutes your fonts — print to PDF instead
tags: [tooling, word, office-automation, pdf, fonts, com, windows]
applies-to: Microsoft Word (COM automation or manual export) on Windows, any non-system font
last-reviewed: 2026-08-24
---

# Word's PDF export silently substitutes your fonts — print to PDF instead

> **Bottom line.** `Document.ExportAsFixedFormat` can drop every custom font from the PDF and lay the text out in Calibri/Times instead — while Word still lists the font, reports it on the range, and happily embeds it into `.docx`. Use `Document.PrintOut` to the "Microsoft Print to PDF" printer, install **static** font instances (not variable `*-VariableFont_wght.ttf`), and verify the result by reading the `name` table inside the embedded `FontFile2`.
>
> **Ve zkratce.** `Document.ExportAsFixedFormat` umí z PDF vyhodit všechna vlastní písma a vysázet text v Calibri/Times – přestože Word to písmo vypisuje, hlásí ho na rozsahu a bez potíží ho vloží do `.docx`. Použij `Document.PrintOut` na tiskárnu „Microsoft Print to PDF", nainstaluj **statické** řezy (ne variabilní `*-VariableFont_wght.ttf`) a výsledek ověř `name` tabulkou uvnitř vloženého `FontFile2`.

## Symptom

You generate a `.docx` with a brand typeface, export it to PDF from Word, and the PDF looks wrong — or looks fine at a glance and turns out to contain none of your fonts.

Everything you can easily check says the font is fine:

- `Application.FontNames` contains it.
- `Range.Font.Name` on the paragraph returns it.
- The font is installed, and `fsType` is `0` (installable embedding).
- `Document.EmbedTrueTypeFonts = True` embeds it into `.docx` without complaint.

Only the PDF disagrees. Its font resources are `Calibri`, `TimesNewRomanPSMT` and `ArialMT` — the fonts you never asked for.

## Cause

Two independent problems that look like one.

**1. `ExportAsFixedFormat` substitutes.** Word's fixed-format export path can fall back to system fonts for text it renders perfectly well on screen and embeds correctly into `.docx`. None of the obvious levers change it: PDF/A (`UseISO19005_1:=True`), `EmbedTrueTypeFonts`, `SaveSubsetFonts`, `SaveAs2` with the PDF format, or `BitmapMissingFonts`. Note that `BitmapMissingFonts` would rasterise a genuinely *missing* font — the fact that you get real Calibri glyph outlines instead proves Word did not consider the font missing. It substituted it.

**2. Variable fonts collapse to their default instance.** GDI has no variable-axis support, so a `*-VariableFont_wght.ttf` renders only at its default weight. For families whose default instance is a light weight, bold headings come out thin — or get a smeared synthetic bold — even when the run is genuinely bold. The font also registers under its default style name (for example `<Family> ExtraLight`), which is what you will see turning up in the output.

The two combine badly: fixing only the export path leaves you with correct-but-wrong-weight fonts, and fixing only the install leaves you with no custom fonts at all.

## Fix

**Print instead of export.** `PrintOut` to "Microsoft Print to PDF" goes through GDI and embeds the real outlines:

```powershell
$w = New-Object -ComObject Word.Application
$w.Visible = $false; $w.DisplayAlerts = 0
$w.ActivePrinter = 'Microsoft Print to PDF'
$d = $w.Documents.Open($src, $false, $true)
$d.PrintOut([ref]$false, [ref]$false, [ref]0, [ref]$outPdf)   # Background=false, Append=false, Range=all, OutputFileName
```

Printing is spooled, so wait for the file size to stop changing before you read it. Note the trade-off: the print path loses hyperlinks, bookmarks and structure tags — fine for a read-only deliverable, not for an accessible or navigable document.

**Install static instances.** Take the `static/` folder from the font distribution rather than the single variable file. Register per-user (no admin needed) by copying into `%LOCALAPPDATA%\Microsoft\Windows\Fonts` and adding a `HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts` value named `<Full Name> (TrueType)`. Read the full name out of the font's own `name` table (nameID 4) rather than guessing it from the filename.

**Load them in the process that starts Word.** `AddFontResourceW` from a process that then exits does not help a Word instance started later. Remove the variable duplicates and add the static ones in the *same* process, then create the Word COM object:

```powershell
Get-ChildItem $dir -Filter '*VariableFont*.ttf' | ForEach-Object { while ([FI]::RemoveFontResourceW($_.FullName)) {} }
Get-ChildItem $dir -Filter '*.ttf' | Where-Object { $_.Name -notmatch 'VariableFont' } |
  ForEach-Object { [void][FI]::AddFontResourceW($_.FullName) }
$w = New-Object -ComObject Word.Application     # až teď
```

Registry entries alone take effect at the next logon, which is why the in-process dance is needed for the current session.

**Ship `.docx` with fonts embedded** so the recipient needs nothing installed:

```powershell
$d.EmbedTrueTypeFonts = $true
$d.SaveSubsetFonts = $false      # full faces survive editing; subset if size matters more
```

## Verify

Do not trust `/BaseFont` names. "Microsoft Print to PDF" anonymises embedded fonts to `CIDFont+F1`, `CIDFont+F2`… so a correct PDF and a broken one both look uninformative. The identity survives in the `name` table of the embedded `FontFile2`: walk the PDF's streams, inflate them, keep the ones whose first four bytes are a TrueType signature (`0x00010000`, `true`, `ttcf`), and read nameID 4 or 1.

A correct result names the real faces and the real weights — `<Family> Bold` for headings, not `<Family> ExtraLight`. A broken one names Calibri and Times.

The same check is what tells the two failure modes apart: substituted fonts show as system fonts, a variable-font mismatch shows as the right family at the wrong weight.

## See also

- [Git Bash mangles backslashes for native exes](git-bash-mangles-backslashes-for-native-exes.md) — the other "the tool quietly changed your input" trap on Windows
