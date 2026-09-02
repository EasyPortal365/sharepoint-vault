---
title: A version is a full copy, not a delta — and a metadata-only edit costs one
tags: [versioning, storage, quota, lists, libraries, governance, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-09-02
---

# A version is a full copy, not a delta — and a metadata-only edit costs one

> **Bottom line.** Every version of a file counts against your storage quota at the *full* size of the file, not as a difference from the previous version. Changing only a column value — no content edit at all — creates a version that costs another full copy, which makes bulk metadata updates one of the most expensive operations you can run on a library. "SharePoint uses shredded storage so versions are deltas" conflates a SQL-level mechanism in on-premises SharePoint with quota accounting; Microsoft's own KB says the quota component has no direct relationship to it.
>
> **Ve zkratce.** Každá verze souboru se do kvóty počítá v *plné* velikosti souboru, ne jako rozdíl proti předchozí verzi. Změna pouhé hodnoty sloupce – bez jediného zásahu do obsahu – vytvoří verzi, která stojí další plnou kopii, takže hromadné úpravy metadat patří k nejdražším operacím nad knihovnou. Tvrzení „SharePoint používá shredded storage, takže verze jsou delty" míchá dohromady mechanismus uvnitř SQL Serveru u on-premises SharePointu a účtování kvóty; vlastní KB Microsoftu říká, že kvótová komponenta s ním nemá přímý vztah.

## Symptom

A library holds a handful of documents. The Size column adds up to a few hundred kilobytes, but the site's storage usage is several times that. Or: a migration script fills in a managed column across ten thousand documents, touching no file content, and storage jumps by the total size of the library.

## Measure it yourself

The REST API returns a size per version. This is the number the quota is built on — Microsoft's documentation for the version storage usage report defines the `Size` column as "the size of the version in bytes".

```
GET /_api/web/GetFileByServerRelativeUrl('/sites/projects/Shared Documents/report.docx')/Versions?$select=VersionLabel,Size
Accept: application/json;odata=nometadata
```

A controlled experiment removes any doubt about whether content changes are responsible. Upload a file of a known size, then change **only** a column value several times:

```
POST /_api/web/lists/getbytitle('Documents')/items(<id>)
Accept:       application/json;odata=nometadata
Content-Type: application/json;odata=nometadata
X-HTTP-Method: MERGE
IF-MATCH:      *
X-RequestDigest: <digest from POST /_api/contextinfo>

{ "Title": "metadata only" }
```

Measured on a live tenant (September 2026, library with versioning on, minor versions off, 500 major version limit), starting from a file of exactly 1,048,576 bytes:

| After | Current version | Historical versions | Total |
|---|---|---|---|
| upload | 1.0 (1,048,576 B) | – | 1.00 MB |
| metadata change 1 | 2.0 (1,048,576 B) | 1.0 | 2.00 MB |
| metadata change 2 | 3.0 (1,048,576 B) | 1.0, 2.0 | 3.00 MB |
| metadata change 3 | 4.0 (1,048,576 B) | 1.0, 2.0, 3.0 | 4.00 MB |

Three edits, no content change, four times the storage. The increment was exactly the full file size every time.

A historical version is also a complete, independently retrievable file — not something reassembled from increments. Downloading one returns the full byte count:

```
GET /_api/web/GetFileByServerRelativeUrl('<path>')/Versions(<id>)/$value
→ 1,048,576 bytes
```

## Cause

Two separate things get conflated.

**Shredded storage is real**, but it is a SharePoint Server 2013 mechanism operating inside SQL Server. Microsoft's KB 3038333 describes exactly this scenario — a 100 MB file, a metadata-only change, 200 MB reported — and explains it:

> "This behavior is by design. SharePoint Server 2013 uses SQL Server Shredded Storage to improve data transfer performance and reduce storage utilization. But the SharePoint quota component has no direct relationship to how SQL Server stores it physical data. Therefore, the quota component can't report on the space that's used on SQL Server physical storage."

That sentence is routinely quoted as proof that versions are cheap. It says the opposite of what people take from it: the quota cannot see physical storage, so it counts full sizes. And it is about the on-premises product — SharePoint Online stores content differently and Microsoft publishes no details of its internal layout.

**Indirect confirmation** comes from the automatic version history limits Microsoft shipped in 2024, which are documented as producing "96% version storage reduction in six months period compared to count limits". Trimming intermediate versions cannot save 96% of anything if those versions were deltas.

## Fix

- Switch version history limits to **Automatic** at organisation level. Under that algorithm users keep all versions within the 500 limit for 30 days, hourly versions to day 60, daily versions to day 180, and weekly versions beyond that.
- Run a **version storage usage report** and a *what-if* analysis before changing limits (`New-SPOSiteFileVersionExpirationReportJob`, `New-SPOListFileVersionExpirationReportJob`). On large sites the job takes days.
- **Trim existing versions** to reclaim space — but note this bypasses the recycle bin and is irreversible. Versions a *user* deletes by hand do go to the recycle bin and keep holding space until it is emptied.
- Before a bulk metadata update or a migration script, consider whether versioning needs to stay on for the duration. This is the single cheapest way to multiply a library's footprint without adding any content.
- Expect exceptions: version limits are ignored for content under a retention policy or eDiscovery hold, and version deletion is blocked outright on items marked as records.

## What this does not prove

The measurement covers **sizes reported by the service** — the figures the quota is computed from. Physically occupied storage in Microsoft's datacentre cannot be measured from outside and is not published. The `StorageMetrics` endpoint returned zeros on the tenant tested, so library-level cross-checking was unavailable, and aggregate site storage usage updates with a documented delay of up to 48 hours, which makes an immediate before/after read on the quota unreliable.

## See also

- [major-version-limit-zero-means-unlimited](major-version-limit-zero-means-unlimited.md)
- [file-versions-are-oldest-first](../rest-api/file-versions-are-oldest-first.md)
