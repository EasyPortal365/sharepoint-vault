---
title: Building a people picker in SPFx — the endpoints that actually work
tags: [spfx, rest-api, search, people-picker]
applies-to: SharePoint Online (SPFx)
last-reviewed: 2026-07-15
---

# Building a people picker in SPFx — the endpoints that actually work

> **Bottom line.** For an org-wide people picker in SPFx, skip `clientPeoplePickerSearchUser` (empty via SPHttpClient) and `/web/siteusers` (only the site's user list) — query the SP Search People result source, then resolve the integer user ID with `ensureuser`.
>
> **Ve zkratce.** Pro celofiremní people picker v SPFx vynech `clientPeoplePickerSearchUser` (přes SPHttpClient vrací prázdno) i `/web/siteusers` (jen uživatelé webu) – dotazuj se na People result source v SP Search a číselné user ID dořeš přes `ensureuser`.

## Update 2026-08-22 — the endpoint is fine, `SPHttpClient` is not (and groups are a different story)

The advice above stands **for people**. For **groups** there is no alternative — `siteusers` only knows the site's users and Search People returns people — so the picker endpoint is the only way, and it does work when you call it with a plain same-origin `fetch` instead of `SPHttpClient`:

```js
const digest = await fetch(web + "/_api/contextinfo", { method: "POST", credentials: "same-origin",
  headers: { Accept: "application/json;odata=nometadata" } }).then(r => r.json()).then(j => j.FormDigestValue);

const res = await fetch(web + "/_api/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.ClientPeoplePickerSearchUser", {
  method: "POST", credentials: "same-origin",
  headers: { Accept: "application/json;odata=nometadata",
             "Content-Type": "application/json;odata=verbose",   // the endpoint insists on verbose here
             "X-RequestDigest": digest },
  body: JSON.stringify({ queryParams: {
    __metadata: { type: "SP.UI.ApplicationPages.ClientPeoplePickerQueryParameters" },
    QueryString: term, MaximumEntitySuggestions: 12,
    PrincipalType: 15,      // users + security groups + SP groups
    PrincipalSource: 15,    // all sources, directory included
    AllowEmailAddresses: true, AllowMultipleEntities: true, AllUrlZones: false, SharePointGroupID: 0 } })
});
const entities = JSON.parse((await res.json()).value);
```

- The `objectId` of an Entra group comes from the claim in `Key` (`c:0o.c|federateddirectoryclaimprovider|<guid>` for M365 groups, `c:0t.c|tenant|<guid>` for security groups) — `EntityData.ObjectId` is often `null`.
- **Do not offer SharePoint groups for anything you later resolve through Graph**: they have no objectId, so a membership check (`checkMemberGroups`) can never confirm them.
- Meta-lesson: when a note says "endpoint X does not work", check whether the verdict belongs to the endpoint or to the **transport**. Ruling out the whole endpoint closed the only path to group search here.

## Symptom

You're building a custom people picker and the obvious endpoints let you down one by one:

- `POST /_api/SP.UI.ApplicationPages.ClientPeoplePickerWebServiceInterface.clientPeoplePickerSearchUser` returns **empty results** when called through SPFx's `SPHttpClient` — the same request works from other clients.
- `GET /_api/web/siteusers?$filter=…` returns only a **fraction of the organisation**.

## Cause

- `SPHttpClient.configurations.v1` normalizes headers in ways the picky `clientPeoplePickerSearchUser` endpoint doesn't tolerate — you get a well-formed, empty response instead of an error.
- `/web/siteusers` isn't a directory — it's the site's **User Information List**: only people who have visited the site or been granted permission on it. Useless for org-wide search.

## Fix

Query the **SP Search "People" result source** — it searches the whole tenant (profiles synced from Entra ID) and works fine from SPFx:

```ts
const q = new URLSearchParams({
  querytext:        `'${query}*'`,
  sourceid:         `'B09A7990-05EA-4AF9-81EF-EDFAB16C4E31'`,   // well-known People result source
  selectproperties: `'AccountName,PreferredName,WorkEmail'`,
  rowlimit:         '8'
});

const res = await spHttpClient.get(
  `${webUrl}/_api/search/query?${q.toString()}`,
  SPHttpClient.configurations.v1,
  { headers: { 'odata-version': '3.0', 'Accept': 'application/json;odata=nometadata' } }
);

const rows = (await res.json()).PrimaryQueryResult?.RelevantResults?.Table?.Rows ?? [];
const people = rows
  .map((row: { Cells: Array<{ Key: string; Value: string | null }> }) => {
    const cell = (k: string) => { const c = row.Cells.filter(x => x.Key === k)[0]; return c && c.Value ? c.Value : ''; };
    return { title: cell('PreferredName'), email: cell('WorkEmail'), loginName: cell('AccountName') };
  })
  .filter(p => p.title && p.loginName);
```

When the user picks a result and you need the classic **SharePoint integer user ID** (for a Person field), resolve it with `ensureuser` — idempotent and fast:

```ts
const eu = await spHttpClient.post(`${webUrl}/_api/web/ensureuser`,
  SPHttpClient.configurations.v1,
  {
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json;odata=nometadata' },
    body: JSON.stringify({ logonName: person.loginName })   // AccountName arrives in claims format — pass as-is
  });
const spUserId = (await eu.json()).Id;
```

## Notes

- The `sourceid` GUID above is the built-in People result source — the same on every tenant.
- Note the `odata-version: 3.0` header — the search endpoint [demands it](../rest-api/search-api-needs-odata-version-3.md).
- Results depend on the search index; brand-new users can take a while to appear.
- Searching **Entra groups** is a different road: Microsoft Graph `GET /v1.0/groups?$filter=startswith(displayName,'…')` via `AadHttpClient` (needs an approved `Group.Read.All` API permission request).
- Rendering the dropdown? Mind the [CSS transform trap](fixed-dropdowns-in-transformed-panels.md) — inside animated panels it will position itself off-screen.
