---
title: A file's time is not its item's time – a copy job carries the item time, and ListItemAllFields returns dates in the web's zone without "Z"
short-title: File time vs. item time, and ListItemAllFields dates
summary: "TimeCreated/TimeLastModified of a file can differ from the item's Created/Modified by seconds or years; copy jobs carry the item time, so compare items – and read them from /items(id) (UTC), because ListItemAllFields returns web-local time without Z"
tags: [rest-api, dates, time-zone, copy-move, migration, verification]
applies-to: SharePoint Online
last-reviewed: 2026-11-01
---

# A file's time is not its item's time – a copy job carries the item time, and ListItemAllFields returns dates in the web's zone without "Z"

> **Bottom line.** In a document library, the file's `TimeCreated`/`TimeLastModified` and the list item's `Created`/`Modified` are two different values. In old content they can differ by seconds (a PDF: file 10:47:11Z, item 10:47:06Z) or by years (an `.xls`: file modified 2025, item modified 2016 – the file was rewritten later while the item kept its date). `CreateCopyJobs` carries the **item** time, and in the target the file gets the same value. A verification that compares file times on both sides therefore reports mismatches no user will ever see; compare the item times. And read them from `GetList(...)/items(id)`: `GetFileByServerRelativePath(...)/ListItemAllFields?$select=Created,Modified` returns the dates in the **web's regional time zone without a trailing "Z"**, so treating them as UTC shifts them by hours, and two webs in different zones cannot be compared at all.
>
> **Ve zkratce.** V knihovně dokumentů jsou `TimeCreated`/`TimeLastModified` souboru a `Created`/`Modified` položky dvě různé hodnoty. U starého obsahu se liší o vteřiny (PDF: soubor 10:47:11Z, položka 10:47:06Z) i o roky (`.xls`: soubor změněn 2025, položka 2016 – soubor byl později přepsán a položka si datum nechala). `CreateCopyJobs` přenáší čas **položky** a soubor v cíli dostane stejnou hodnotu. Ověření, které porovnává časy souborů, proto hlásí rozdíly, které uživatel nikdy neuvidí – porovnávej časy položek. A čti je z `GetList(...)/items(id)`: `GetFileByServerRelativePath(...)/ListItemAllFields?$select=Created,Modified` vrací datum v **regionální zóně webu bez koncového „Z“**, takže jako UTC je posunuté o hodiny a dva weby v různých zónách nejdou porovnat vůbec.

## Symptom

After a copy job between two libraries, a verification sampled files and compared `TimeCreated`/`TimeLastModified` of the source and target files. PDFs came back as "Created/Modified mismatch" by 4–5 seconds, with the target **earlier** than the source; in a large library 26 of 50 sampled files reported "Modified mismatch"; the one measured in detail differed by years. All files were present and their content was intact.

## Cause

Measured on SharePoint Online on 1 November 2026, the same files read four ways:

| | file `TimeCreated` | item `Created` |
|---|---|---|
| source PDF | `2017-02-01T10:47:11Z` | `2017-02-01T10:47:06Z` |
| target PDF | `2017-02-01T10:47:06Z` | `2017-02-01T10:47:06Z` |

- The copy job writes the source **item** time to the target item **and** to the target file. The source file's own time is not carried.
- The file time in the source can be a few seconds later than the item time, or years later (an `.xls` whose file `TimeLastModified` is 2025 while the item `Modified` is 2016).

Reading the item through the file returns a local time:

```
GET {web}/_api/web/GetFileByServerRelativePath(decodedurl=@p)/ListItemAllFields?@p='/sites/x/Docs/a.pdf'&$select=Id,Created
→ { "Id": 2, "Created": "2019-03-04T01:15:00" }        // web in UTC−8, no "Z"

GET {web}/_api/web/GetList(@l)/items(2)?@l='/sites/x/Docs'&$select=Created
→ { "Created": "2019-03-04T09:15:00Z" }                 // UTC
```

## Fix

Compare what the user sees and what the copy carries – the item – and read it in UTC:

```ts
// path = server-relative file URL, root = server-relative library URL
const at = "/_api/web/GetFileByServerRelativePath(decodedurl=@p)";
const p = "?@p='" + encodeURIComponent(path.replace(/'/g, "''")) + "'";
const { Id } = await get(web + at + "/ListItemAllFields" + p + "&$select=Id");
const item = await get(web + "/_api/web/GetList('" + encodeURIComponent(root.replace(/'/g, "''")) + "')/items(" + Id + ")?$select=Created,Modified");
// item.Created / item.Modified end with "Z"
```

Keep a tolerance of a couple of seconds, and never treat a date from `ListItemAllFields` as UTC.

## Notes

- Bulk reads through `GetList(...)/items?$select=Created,Modified` already return UTC; the trap is the per-file path through `ListItemAllFields`.
- Older binary Office files (`.xls`, `.doc`, `.ppt`) also change size in the target by a few kB, like OOXML files: SharePoint rewrites the library metadata inside them (measured: `.xls` 99,328 → 95,744 bytes, 161 of 194 512-byte sectors unchanged). See [Office files and property demotion](../graph/office-files-property-demotion.md).
