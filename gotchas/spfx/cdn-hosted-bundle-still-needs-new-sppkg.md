---
title: A CDN-hosted SPFx bundle still needs a new .sppkg
tags: [spfx, app-catalog, deployment, cdn]
applies-to: SharePoint Online
last-reviewed: 2026-07-28
---

# A CDN-hosted SPFx bundle still needs a new `.sppkg`

> **Bottom line.** `includeClientSideAssets: false` moves your *assets* off SharePoint, not your *versioning* — the manifest inside the `.sppkg` pins an exact content-hashed filename, so a tenant running the old package keeps requesting the old bundle and never sees your CDN update.
>
> **Ve zkratce.** `includeClientSideAssets: false` přesouvá mimo SharePoint *assety*, ne *verzování* – manifest uvnitř `.sppkg` ukazuje na konkrétní soubor s content-hashem, takže tenant se starým balíčkem si dál žádá starý bundle a novou verzi z CDN nikdy neuvidí.

## Symptom

You host your SPFx bundles on an external CDN (`cdnBasePath` + `includeClientSideAssets: false`). You ship a code change: rebuild, upload the new bundle to the CDN, confirm it returns HTTP 200. Users hard-refresh — and still run the **old** code. No errors, no 404s, nothing in the console.

Especially confusing when the fix lives in a **shared library** consumed by many web parts: every app was rebuilt, every bundle is on the CDN, and yet nothing changed anywhere.

## Cause

The `.sppkg` contains the component manifest, and the manifest names an exact file:

```json
"loaderConfig": {
  "internalModuleBaseUrls": ["https://cdn.example.com/myapp/"],
  "entryModuleId": "my-web-part",
  "scriptResources": {
    "my-web-part": { "type": "path", "path": "my-web-part_06bdff7eae68a5d47bbe.js" }
  }
}
```

That hash is derived from bundle **content**. Change one line and the filename changes — but the tenant's App Catalog still serves the manifest from the package it already has, which points at the previous filename. The new file sits on the CDN, correctly served, and simply never gets requested.

`includeClientSideAssets: false` only controls whether assets are packed into the `.sppkg` and provisioned into the `ClientSideAssets` library. It does nothing to how component versions are resolved.

## Fix

Treat any code change as a full release:

1. Bump `solution.version` in `config/package-solution.json`.
2. Build and upload the new bundle to the CDN (keep the old one — see below).
3. **Upload the new `.sppkg` to each tenant's App Catalog.**

## Don't confuse this with the per-site upgrade prompt

Two different things get mixed up:

| Claim | True? |
|---|---|
| After uploading `.sppkg` to the App Catalog, you must click *"An update for this app is available"* on every site | **Usually no** — if your `elements.xml` is empty and `upgradeActions` is a no-op, the per-site upgrade changes nothing. Code loads from the CDN, so `Ctrl+R` is enough. |
| You can skip the App Catalog upload entirely because the code is on the CDN | **No** — the manifest pins the filename. |

The first statement is what makes the second one sound plausible. Verify by opening the generated manifest in `dist/*.manifest.json` and reading `scriptResources`.

## Rollout note: keep the old bundles

Because old packages reference old filenames, **never delete previous bundles from the CDN** just because a new one shipped. Any tenant that hasn't uploaded the new `.sppkg` yet — plus lazy-loaded chunks that get republished only when their own content changes — will still be requesting them. Prune only by reachability from live entry points, never by age or version.
