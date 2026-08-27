---
title: Enumerate every site from the browser console (no admin API, no tooling)
tags: [search, rest-api, javascript, tenant]
applies-to: SharePoint Online
last-reviewed: 2026-08-27
---

# Enumerate every site from the browser console (no admin API, no tooling)

> **Bottom line.** A Search REST query for `contentclass:STS_Site OR contentclass:STS_Web` from any signed-in browser tab lists every site and subweb the account can read — no SharePoint Admin role, no PowerShell, no app registration. Combine it with plain `fetch` against each web's `/_api` and you have a tenant-wide inventory-and-fix sweep that runs entirely in the F12 console.
>
> **Ve zkratce.** Search REST dotaz na `contentclass:STS_Site OR contentclass:STS_Web` z přihlášené záložky prohlížeče vypíše všechny weby, které účet vidí – bez role SharePoint Admin, bez PowerShellu, bez registrace aplikace. Spolu s obyčejným `fetch` na `/_api` jednotlivých webů z toho je tenant-wide inventura i oprava, celá v F12 konzoli.

## Symptom

You need to check (or fix) something on *every* site in the tenant — a config item, a list's presence, a setting — and you have nothing at hand: the tenant-admin REST API returns 403 without the SharePoint Administrator role, there is no SPO Management Shell on this machine, and an app registration is overkill for a one-off sweep.

## Cause

All the "proper" enumeration surfaces (`Get-SPOSite`, the `/_api/Microsoft.Online.SharePoint.TenantAdministration` endpoints) are admin-gated. But the search index is not: it already knows every site and web, and it answers any signed-in user — security-trimmed to what that account can read.

## Fix

From any tab on the tenant (same-origin, cookies ride along):

```js
const ORIGIN = 'https://contoso.sharepoint.com';
const q = ORIGIN + "/_api/search/query?querytext='(contentclass:STS_Site OR contentclass:STS_Web)"
        + " AND Path:\"" + ORIGIN + "/*\"'&selectproperties='Path,Title,WebTemplate'"
        + "&rowlimit=500&trimduplicates=false";
const r = await fetch(q, { headers: {
  Accept: 'application/json;odata=nometadata',
  'odata-version': '3.0'          // Search REST is OData 3 — see the linked gotcha
}});
const rows = (await r.json()).PrimaryQueryResult.RelevantResults.Table.Rows;
const webs = rows.map(row => Object.fromEntries(row.Cells.map(c => [c.Key, c.Value])));
```

- `STS_Site` = site collection roots, `STS_Web` = subwebs; you usually want both, deduplicated by `Path`.
- The [`odata-version: 3.0` header is mandatory](../rest-api/search-api-needs-odata-version-3.md) on Search REST.
- Compare `TotalRows` against the rows you received — past `rowlimit` you must page with `startrow`, and a silently truncated inventory looks complete.
- Results are security-trimmed: you enumerate what the signed-in account can read, which for a sweep is exactly the set of sites you can act on anyway.

Then sweep: for each web, plain `fetch` against `ORIGIN + webPath + '/_api/...'` works cross-site because it is all one origin. Traps that will bite a naive loop, each of them field-paid:

1. **Do not filter lists with `$filter=Hidden eq false`.** Apps and provisioning code routinely mark their settings lists hidden on purpose; the filter makes them "not exist" and your sweep reports a false negative. Pull all lists and match on `RootFolder/ServerRelativeUrl` instead:

   ```js
   const lr = await fetch(ORIGIN + webPath +
     '/_api/web/lists?$select=Title,RootFolder/ServerRelativeUrl&$expand=RootFolder&$top=500',
     { headers: { Accept: 'application/json;odata=nometadata' } });
   ```

2. **[Resolve lists by URL](../rest-api/get-list-by-url-not-by-title.md), and mind the case.** `GetList('/sites/Team-A/Lists/TeamSettings')` is case-sensitive about the *web* part of the path when you build it by hand — a lowercase guess returns HTTP 400 even though the list is there. Feed it the exact `ServerRelativeUrl` you just read, never a string you composed.

3. **HTTP 400 vs 404 tell different stories.** `$select` on a column that does not exist on *that* web's list returns 400 `The field or property 'X' does not exist` — the list is fine, its schema is older than you assume (or your column name is wrong). 404 means the list itself is missing. Branch on them separately, or an older site will read as "app not installed".

4. **Writes need a digest from the *target* web.** POST `webPath + '/_api/contextinfo'` per web and send its `FormDigestValue` as `X-RequestDigest`; the digest baked into the page you happen to be sitting on belongs to that page's web (and [expires anyway](../rest-api/request-digest-expires-mid-session.md)). For updates send `IF-MATCH: *` + `X-HTTP-Method: MERGE`; for inserts a plain POST with `Accept: application/json`.

5. **Fail closed, per item.** On any read that is not a clean 200 with the expected shape, *skip and report* — never write a "repair" based on a failed read. A sweep's value is the honest exception list at the end, not a forced 100 % success count.

Read-back after every write (`$filter` the row again, compare the value) turns the console transcript into its own audit log — worth keeping for a tool this blunt.
