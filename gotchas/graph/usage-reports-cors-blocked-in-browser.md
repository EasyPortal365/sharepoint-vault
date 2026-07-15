---
title: Graph usage reports can't be called from the browser — CORS blocks the download redirect
tags: [graph, reports, cors, spfx, admin]
applies-to: Microsoft Graph (SharePoint Online context)
last-reviewed: 2026-07-16
---

# Graph usage reports can't be called from the browser — CORS blocks the redirect

## Symptom

You build an admin dashboard in SPFx and call the usage reports, e.g. `GET /reports/getSharePointSiteUsageDetail(period='D30')` with `Reports.Read.All` granted. The request dies in the browser with a CORS error — no matter which permissions you add.

## Cause

Reports endpoints answer with a **302 redirect to a pre-authenticated download URL** — and that download host sends **no CORS headers**. Browsers block the redirected request; permissions never enter the picture. This is architectural, not a misconfiguration you can fix on your side.

## Fix

Split the need in two:

- **Usage/activity reports** → fetch them **server-side** (Azure Function, background job) and serve the digest to your web part yourself.
- **"Just give me an inventory of sites" from the browser** — you don't need the reports API at all:
  1. **SP Search**: `contentclass:STS_Site` via `/_api/search/query` — same-origin (no CORS), and **security-trimmed** to what the current user may see. Page with `rowlimit` + `startrow`.
  2. **Per-site storage**: `{siteUrl}/_api/site/usage` → `.Storage`, `.StoragePercentageUsed`.
  3. A **full, untrimmed tenant list** exists only via Graph `getAllSites` — and that's [app-only territory](tenant-wide-enumeration-is-app-only.md) for a backend, not for delegated browser calls.

## Notes

- Related trap on admin dashboards: `signInActivity` on `/users` returns **403 without an Entra ID P1 licence** — query it in a try/catch and degrade gracefully instead of failing the whole page.
- After an admin grants new consent, the user's **existing token still carries the old scopes** — the first call 403s, then works after a token refresh. Don't cache that first 403 as "feature unavailable".
