---
title: "`MajorVersionLimit: 0` means unlimited, not none"
tags: [lists, libraries, versioning, storage, governance]
applies-to: SharePoint Online
last-reviewed: 2026-09-02
---

# `MajorVersionLimit: 0` means unlimited, not none

> **Bottom line.** A library that answers `EnableVersioning: true, MajorVersionLimit: 0` keeps **every version forever** — the zero is the API's way of writing "no limit", so a governance report that prints the raw number tells its reader the exact opposite of the truth about the libraries eating their tenant quota.
>
> **Ve zkratce.** Knihovna, která vrátí `EnableVersioning: true, MajorVersionLimit: 0`, si drží **všechny verze navždy** – nula je způsob, jakým API zapisuje „bez limitu", takže governance report tisknoucí syrové číslo říká čtenáři pravý opak pravdy o knihovnách, které mu žerou kvótu tenantu.

## Symptom

A storage audit exports library settings and the CSV reads:

| Library | EnableVersioning | MajorVersionLimit |
|---|---|---|
| Documents | True | 500 |
| Project Archive | True | **0** |
| Site Assets | False | **0** |

Everyone reading it concludes that *Project Archive* keeps no versions and is therefore not the storage problem. It is the storage problem: it keeps all of them, and it is the only library in the tenant that does.

## Cause

`MajorVersionLimit` is an `Int32` with no nullable state, so SharePoint overloads `0` to mean "unlimited". The value is also left at `0` when versioning is switched off entirely — at which point it means nothing at all. One number, three readings:

| EnableVersioning | MajorVersionLimit | What it actually means |
|---|---|---|
| `true` | `0` | Unlimited — every major version retained forever |
| `true` | `n > 0` | Keep the newest `n` major versions |
| `false` | `0` | Versioning off; the limit is meaningless, not zero |

The UI never shows you this: the library settings page renders an unchecked "Limit the number of versions" box, which is honest but does not travel into any export. Every API surface reports the raw integer — CSOM, PnP (`Get-PnPList -Includes MajorVersionLimit`), REST (`/_api/web/lists/GetById('...')?$select=EnableVersioning,MajorVersionLimit`) and Graph alike.

Minor versions carry the same overload in `MajorWithMinorVersionsLimit`, with an extra wrinkle: that one is *drafts kept for how many major versions*, not a count of drafts.

## Fix

Never emit the raw number. Resolve the three states at the point where you read them:

```powershell
$policy = if (-not $list.EnableVersioning) {
    'Versioning OFF'
}
elseif ($list.MajorVersionLimit -eq 0) {
    'UNLIMITED major versions'
}
else {
    'Keep {0} major versions' -f $list.MajorVersionLimit
}
```

The same shape in TypeScript against REST:

```typescript
const versionPolicy = (list: { EnableVersioning: boolean; MajorVersionLimit: number }): string => {
  if (!list.EnableVersioning) { return 'off'; }
  return list.MajorVersionLimit === 0 ? 'unlimited' : `keep ${list.MajorVersionLimit}`;
};
```

Sorting a governance report by `MajorVersionLimit` ascending puts the worst offenders — the unlimited ones — at the top of the "keeps fewest versions" column. If you rank on this field, map `0` to `Int32.MaxValue` first.

## Notes

- SharePoint Online now defaults new libraries to *automatic* version limits (an age- and count-based expiration managed by the service) rather than a fixed number. Libraries created before that, and any library where somebody set a limit by hand, keep the classic behaviour — so a tenant contains both, and the report has to survive both.
- Setting a limit does not trim what is already there. Applying `MajorVersionLimit = 10` to a library holding 400 versions per file reclaims nothing until each file is next edited, or until you trim history explicitly.
- Versions deleted through the API do not go to the recycle bin — measured on a live tenant: `POST /Versions/DeleteByLabel(versionlabel='1.0')` removed the version and neither the web nor the site collection recycle bin gained an entry. Do not generalise that to the UI: Microsoft documents that when *a user* deletes a version from a file's version history, "the deleted version is moved to the site's recycle bin and can be recovered for a period". Treat the two paths as different until you have tested the one you rely on. Measure before you trim: [Get-FileVersionBloatReport.ps1](../../scripts/cleanup/Get-FileVersionBloatReport.ps1), then [Remove-ExcessFileVersions.ps1](../../scripts/cleanup/Remove-ExcessFileVersions.ps1) with `-WhatIf`.
- The general class — an API where one value means "unset", "unlimited" and "genuinely zero" — is worth a second look wherever a report turns numbers into advice. Related in spirit: [`GetStorageEntity` returns 200 for a missing key](../rest-api/getstorageentity-returns-200-for-missing-key.md).
