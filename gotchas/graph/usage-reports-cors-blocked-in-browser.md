---
title: Graph usage reports in the browser — the v1.0 CSV redirect is CORS-blocked, beta JSON works
short-title: Usage reports in the browser — use beta JSON
summary: "v1.0 302 to CSV dies on CORS; beta `?$format=application/json` returns 200 from Graph; mind roles and concealed names"
tags: [graph, reports, cors, spfx, admin]
applies-to: Microsoft Graph (SharePoint Online context)
last-reviewed: 2026-10-12
---

# Graph usage reports in the browser — the v1.0 CSV redirect is CORS-blocked, beta JSON works

> **Bottom line.** The v1.0 usage reports answer with a 302 to a CSV download host that sends no CORS headers, so the browser blocks them. The **beta** endpoints with `?$format=application/json` return the data as JSON with **200 straight from graph.microsoft.com** — that works from SPFx. Plan for two more gates: the signed-in user needs a role that sees per-user detail, and tenants **conceal user names by default**.
>
> **Ve zkratce.** v1.0 reporty přesměrují (302) na stažení CSV bez CORS hlaviček a prohlížeč je zablokuje. **Beta** s `?$format=application/json` vrací JSON s **200 přímo z graph.microsoft.com** – z SPFx to funguje. Počítej se dvěma dalšími branami: přihlášený uživatel potřebuje roli s detailem po lidech a tenant **ve výchozím stavu skrývá jména**.

## Symptom

You build an admin dashboard in SPFx and call a usage report, e.g. `GET /v1.0/reports/getSharePointSiteUsageDetail(period='D30')` with `Reports.Read.All` granted. The request dies in the browser with a CORS error — no matter which permissions you add.

## Cause

v1.0 report functions return a **302 redirect to a pre-authenticated download URL** (CSV), and that download host sends **no CORS headers**. The browser blocks the redirected request; permissions never enter the picture.

## Fix

Call the **beta** report function and ask for JSON:

```js
// SPFx MSGraphClientV3
const res = await client
  .api("/reports/getOffice365ActiveUserDetail(period='D30')?$format=application/json")
  .version('beta')
  .get();
// res.value = [{ userPrincipalName, hasExchangeLicense, exchangeLastActivityDate, ... }]
// page with res['@odata.nextLink'] (200 rows per page)
```

The same pattern works for other report functions that document `$format=application/json` on beta (for example `getMicrosoft365CopilotUsageUserDetail`, where JSON is the default). Verified live from a SharePoint page in October 2026: 200, no redirect, no CORS error.

Beta is subject to change — wrap the call so a failure degrades to "not measured" instead of breaking the page.

## Two more gates

1. **Role of the signed-in user.** Delegated access needs a limited admin role in addition to the consented scope: Reports Reader, SharePoint / Exchange / Teams Administrator or Global Administrator. **Global Reader and Usage Summary Reports Reader see tenant-level data only**, without per-user detail.
2. **Concealed names.** Since September 2021 the org setting *Conceal user, group, and site names in all reports* is on by default (Microsoft 365 admin center → Settings → Org settings → Services → Reports). User principal names then come back as hashes without `@`. Totals per service remain valid, but you can't join rows to users — detect it (no `@` in any UPN) and say so instead of reporting everyone as inactive.

## Browser-side site inventory without reports

If all you need is a list of sites, skip the reports API:

1. **SP Search**: `contentclass:STS_Site` via `/_api/search/query` — same-origin and **security-trimmed** to what the current user may see. Page with `rowlimit` + `startrow`.
2. **Per-site storage**: `{siteUrl}/_api/site/usage` → `.Storage`, `.StoragePercentageUsed`.
3. A **full, untrimmed tenant list** exists only via Graph `getAllSites` — [app-only territory](tenant-wide-enumeration-is-app-only.md) for a backend.

## Notes

- Related trap: `signInActivity` on `/users` returns **403 `Authentication_RequestFromNonPremiumTenantOrB2CTenant`** in a tenant without Entra ID P1 — retry the query without it and report "not measured" rather than zero.
- After an admin grants new consent, the user's **existing token still carries the old scopes** — the first call 403s, then works after a token refresh. Don't cache that first 403 as "feature unavailable".

## Sources

- [reportRoot: getOffice365ActiveUserDetail (beta)](https://learn.microsoft.com/en-us/graph/api/reportroot-getoffice365activeuserdetail?view=graph-rest-beta) — `$format` and JSON response
- [Authorization for APIs to read Microsoft 365 usage reports](https://learn.microsoft.com/en-us/graph/reportroot-authorization) — roles
- [Show user, group, or site details in usage reports](https://learn.microsoft.com/en-us/microsoft-365/admin/activity-reports/activity-reports) — concealed names
