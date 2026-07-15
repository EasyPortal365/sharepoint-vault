---
title: Three .sppkg packaging pitfalls — diacritics, icon size, the Publisher column
tags: [app-catalog, packaging, spfx, deployment]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
---

# Three `.sppkg` packaging pitfalls: diacritics, icon size, the Publisher column

Three unrelated traps that all strike at the same moment — packaging or uploading your solution.

## 1. `solution.name` must be ASCII (no diacritics)

### Symptom

```
XmlValidationException: ... NameDefinition — The Pattern constraint failed.
```

during `package-solution`.

### Cause

The solution name ends up in package XML constrained by the `NameDefinition` pattern: spaces, `A–Z`, `a–z`, digits, hyphens and underscores are allowed — **accented characters are not** (`č`, `ř`, `ž`, `ü`, `é`, …).

### Fix

Use an ASCII name in `package-solution.json` (`"name": "Contoso Fleet"`, not `"Contoso Vozový park"`). The *display* name users see in the app catalog and on the site can still be localized elsewhere; the solution name can stay technical.

## 2. `AppIcon.png` must be exactly 96 × 96 px

### Symptom

Upload (or packaging) rejects the icon:

```
... does not meet the required size of '96' pixels
```

### Fix

The `iconPath` image referenced from `package-solution.json` must be **precisely 96 × 96** — not 256 × 256 brand art, not 100 × 100. Resize before committing; any image tool works.

## 3. The Publisher column in the App Catalog is AppSource-only

### Symptom

You set `developer.name` in `package-solution.json` (and maybe `<PublisherName>` in the manifest), yet the **Publisher** column in the tenant App Catalog list stays empty.

### Cause

SharePoint fills that column **only for apps from AppSource / the commercial marketplace**, where it's stamped during Partner Center certification. Tenant-uploaded `.sppkg` packages never populate it, no matter what the manifest says. `developer.name` shows up only in the app's detail panel.

### Fix

Accept it, or edit the list item's properties manually after upload if the column matters to your governance reporting. There is no supported way to set it from the package.

## Notes

- Run the packaging step in CI with a non-English solution name once — you'll catch pitfall 1 years before a colleague renames the product.
