---
title: The crawl log DOES exist in SharePoint Online — it just isn't where you look for it
tags: [search, crawl-log, csom, permissions, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-06
---

# The crawl log DOES exist in SharePoint Online — it just isn't where you look for it

> **Bottom line.** SharePoint Online has no Search Service Application UI and no crawl-time managed property, so it is easy to conclude there is no crawl log. There is one: CSOM `DocumentCrawlLog.GetCrawledUrls`, callable from plain JavaScript via `/_vti_bin/client.svc/ProcessQuery`. It needs a **separate permission grant** that being a tenant admin does *not* give you.
>
> **Ve zkratce.** SharePoint Online nemá správu vyhledávací služby ani vlastnost s časem procházení, takže se snadno usoudí, že crawl log neexistuje. Existuje: CSOM `DocumentCrawlLog.GetCrawledUrls`, volatelný i z čistého JavaScriptu přes `/_vti_bin/client.svc/ProcessQuery`. Vyžaduje ale **samostatné udělení přístupu**, které rolí správce tenantu nezískáte.

## Symptom

You want crawl history for a site — when was this URL last crawled, did it error, is it excluded from the index — and every road looks like a dead end:

- Search managed properties `LastCrawlTime`, `IndexedDate` and `CrawlTime` come back **empty**. (And they always "come back": search echoes any property you ask for, so a `null` proves nothing — see [unknown managed properties fail silently](unknown-managed-properties-fail-silently.md).)
- The classic search admin pages (`/_layouts/15/searchadmin/searchadministration.aspx`) return an error.
- There is no crawl log, crawl health report or crawl schedule anywhere in the SharePoint admin center navigation.

So you conclude the crawl log is an on-premises-only feature. **That conclusion is wrong.**

## Cause

The crawl log is exposed only through **CSOM**, in an assembly most people never touch:
`Microsoft.SharePoint.Client.Search.Administration.DocumentCrawlLog`. There is no REST endpoint and no Graph equivalent, which is why REST-first exploration finds nothing.

On top of that, reading it requires a permission grant that is **not implied by any admin role**. Without it every call fails with `UnauthorizedAccessException` — including for a Global Administrator, which makes it look like a broken or non-existent API rather than a missing grant.

## Fix

### 1. Grant crawl log read access

Open, as a tenant admin:

```
https://<tenant>-admin.sharepoint.com/_layouts/15/searchadmin/crawllogreadpermission.aspx
```

("SharePoint admin center → More features → Search → Crawl Log Permissions".) Add the accounts that need to read the log and confirm. It takes effect immediately — no sign-out needed.

### 2. Call it

From PowerShell, PnP wraps it for you:

```powershell
Get-PnPSearchCrawlLog -ContentSource Sites -Filter "https://<tenant>.sharepoint.com/sites/<site>"
```

From a browser or an SPFx web part there is no wrapper — you post the CSOM request yourself. This runs against a **normal site collection**, not the admin site:

```js
const web = _spPageContextInfo.webAbsoluteUrl;
const digest = (await (await fetch(web + '/_api/contextinfo', {
  method: 'POST', headers: { Accept: 'application/json;odata=nometadata' }
})).json()).FormDigestValue;

const from = new Date(Date.now() - 30 * 86400000).toISOString();
const to = new Date().toISOString();
const P = (type, value) => '<Parameter Type="' + type + '">' + value + '</Parameter>';

// GetCrawledUrls(hotlist, rowLimit, urlFilter, hitCount, contentSourceId, errorLevel, errorId, from, to)
const body =
  '<Request SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="crawl-log"'
  + ' xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009">'
  + '<Actions>'
  + '<ObjectPath Id="4" ObjectPathId="3" />'
  + '<Method Name="GetCrawledUrls" Id="5" ObjectPathId="3"><Parameters>'
  + P('Boolean', 'false') + P('Int64', 100) + P('String', web) + P('Boolean', 'true')
  + P('Int32', -1) + P('Int32', -1) + P('Int32', -1)
  + P('DateTime', from) + P('DateTime', to)
  + '</Parameters></Method>'
  + '</Actions>'
  + '<ObjectPaths>'
  + '<StaticProperty Id="0" TypeId="{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}" Name="Current" />'
  + '<Property Id="2" ParentId="0" Name="Site" />'
  + '<Constructor Id="3" TypeId="{5c5cfd42-0712-4c00-ae49-23b33ba34ecc}">'
  + '<Parameters><Parameter ObjectPathId="2" /></Parameters></Constructor>'
  + '</ObjectPaths></Request>';

const res = await fetch(web + '/_vti_bin/client.svc/ProcessQuery', {
  method: 'POST',
  headers: { 'Content-Type': 'text/xml', 'X-RequestDigest': digest },
  body: body
});
const parsed = JSON.parse(await res.text());

// CSOM reports failures with HTTP 200 — check ErrorInfo, never the status code
if (parsed[0] && parsed[0].ErrorInfo) throw new Error(parsed[0].ErrorInfo.ErrorMessage);

const rows = (parsed.filter(x => x && x._ObjectType_ === 'SP.SimpleDataTable')[0] || {}).Rows || [];
```

The two GUIDs are the CSOM type identifiers for `ClientContext` and `DocumentCrawlLog`. If you ever need such an identifier for another CSOM type, read it out of the shipped client library instead of guessing — it is a string literal in the constructor IL:

```powershell
$asm = [Reflection.Assembly]::LoadFrom('...\Microsoft.SharePoint.Client.Search.dll')
$type = $asm.GetType('Microsoft.SharePoint.Client.Search.Administration.DocumentCrawlLog')
$ctor = $type.GetConstructors()[0]
$il   = $ctor.GetMethodBody().GetILAsByteArray()
for ($i = 0; $i -lt $il.Length - 4; $i++) {
  if ($il[$i] -eq 0x72) {                       # ldstr
    $token = [BitConverter]::ToInt32($il, $i + 1)
    try { $type.Module.ResolveString($token) } catch { }
  }
}
```

## What you get back

An `SP.SimpleDataTable` with roughly 52 columns per row. The ones worth having:

| Column | Meaning |
|---|---|
| `FullUrl` | the crawled URL |
| `TimeStampUtc` | last crawl of this item |
| `TimeStamp_AddModify`, `TimeStamp_SecurityOnly`, `TimeStamp_EnumerateChildren` | separate timestamps for content vs. permissions-only vs. child enumeration passes |
| `ErrorCode`, `ErrorDesc`, `ErrorCount`, `ErrorLevel`, `StatusMessage` | why an item failed to crawl |
| `NoIndex`, `ExclusionReason` | excluded from the index, and why |
| `IsDeleted`, `DeleteReason`, `DeletePending` | removal state |
| `SPItemModifiedTime` | content modification time (UTC) — against `TimeStampUtc` this gives indexing lag |
| `ChildrenCount`, `ParentDocID` | crawl hierarchy |

## Traps when reading the result

- **Values are CSOM-encoded, not plain JSON.** Dates arrive both as `/Date(1785959294170)/` (epoch millis) and as `/Date(2026,7,5,19,48,14,170)/` — where **the month is zero-based**. GUIDs come as `/Guid(...)/`, binary as `/Base64Binary(...)/`. Parse with a regex; `new Date(value)` will not do it.
- **Three different time bases, and two of them lie if taken naively.** This is the trap most likely to reach production, because the wrong values look plausible:

  | Column | Base | How to read it |
  |---|---|---|
  | `TimeStampUtc` | epoch millis, **UTC** | the only unambiguous one — use it for "last crawled" |
  | `TimeStamp`, `TimeStamp_AddModify`, `TimeStamp_SecurityOnly`, `SPItemModifiedTime` | component form, **UTC** | `Date.UTC(y, m, d, …)` — **not** `new Date(y, m, d, …)`, which reads them as browser-local and shifts them by your offset |
  | `LastRepositoryModifiedTime` | FILETIME in the **backend's local time** | 🚫 do not use — see below |

  Read as epoch millis, `LastRepositoryModifiedTime` yields the year ~4,250,000. Converted properly from FILETIME it is still **7 hours ahead of reality**: an item whose REST `Modified` is `2026-08-07T06:14:52Z` carries `SPItemModifiedTime` of exactly `06:14:52Z` but a FILETIME of `13:14:52Z`. Seven hours is US Pacific *daylight* time — meaning **the offset becomes eight in winter**. Take the modification time from `SPItemModifiedTime` instead.

- **Verify one value against an independent source before building a metric on it.** Indexing lag computed from the wrong column produced 20 usable values out of 400 and **367 rows claiming the crawl happened before the change** — which reads as a property of the tenant ("almost everything is waiting to be re-indexed"), not as a conversion bug. The numbers were nonsense, but *plausible* nonsense. After switching to `SPItemModifiedTime`: 387 usable, zero pending, median 23 minutes. One comparison against REST `Modified` would have caught it immediately.
- **HTTP 200 does not mean success.** CSOM reports failures inside `ErrorInfo` with a 200 status — the missing-permission case included.
- **Most rows are not "content".** A quiet 30-day window on one small site returned 468 rows: 466 flagged `NoIndex` (mostly `AllItems.aspx` / `DispForm.aspx` form pages, correctly excluded) and 376 flagged `IsDeleted` (transient list items). Filter before showing this to anyone, or a perfectly healthy site will look alarming.

## Meta-lesson

"This API does not exist in SharePoint Online" is a claim about absence, and two quick probes cannot establish it — especially when both probes tested *different* surfaces (search properties, admin pages) than the one it actually lives on (CSOM). Before declaring a SharePoint capability missing, **grep the PnP PowerShell cmdlets**: they are thin wrappers over CSOM and REST, and they routinely expose surfaces that the documentation never mentions.

## See also

- [Unknown managed properties fail silently](unknown-managed-properties-fail-silently.md) — why `LastCrawlTime: null` proves nothing
- [`NoCrawl` on a library silently blinds your RAG](nocrawl-on-a-library-silently-blinds-your-rag.md) — the `NoIndex` column above, seen from the other end
