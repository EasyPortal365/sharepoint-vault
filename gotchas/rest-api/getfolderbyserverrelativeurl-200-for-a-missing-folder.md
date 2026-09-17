---
title: `getfolderbyserverrelativeurl` returns 200 for a folder that does not exist
tags: [rest-api, folders, existence-check, permissions, provisioning]
applies-to: SharePoint REST (/_api/web/getfolderbyserverrelativeurl), folder provisioning and per-folder permissions
last-reviewed: 2026-09-17
---

# `getfolderbyserverrelativeurl` returns 200 for a folder that does not exist

> **Bottom line.** Asking for a folder that isn't there answers **HTTP 200** with `{"Exists": false}` — not 404. `ListItemAllFields` on that same path also answers **200**, with `{"odata.null": true}`. An existence check that measures `response.ok` concludes "the folder is there", skips creating it, and the next call fails deep inside — typically on `breakroleinheritance`, where a 404 reads like a permissions problem.
>
> **Ve zkratce.** Dotaz na neexistující složku vrací **HTTP 200** s `{"Exists": false}`, ne 404. `ListItemAllFields` na téže cestě taky vrací **200**, s `{"odata.null": true}`. Sonda, která měří `response.ok`, tedy usoudí „složka je", přeskočí založení a spadne až o krok dál — typicky na `breakroleinheritance`, kde 404 vypadá jako problém s oprávněními.

## Measured

Live tenant, a folder that was never created:

```
GET  /_api/web/getfolderbyserverrelativeurl('/sites/x/MyLibrary/sub')?$select=Exists
  → 200   {"Exists": false, "Name": "sub", "ServerRelativeUrl": "/sites/x/MyLibrary/sub"}

GET  /_api/web/getfolderbyserverrelativeurl('/sites/x/MyLibrary/sub')/ListItemAllFields
  → 200   {"odata.null": true}

POST …/ListItemAllFields/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)
  → 404                                   ← the first honest answer in the chain
```

And after creating it:

```
POST /_api/web/folders            {"ServerRelativeUrl": "/sites/x/MyLibrary/sub"}
  → 201
GET  …?$select=Exists             → 200   {"Exists": true}
GET  …/ListItemAllFields          → 200   {"HasUniqueRoleAssignments": false, "Id": 27}
```

Note that the folder's list item is addressable immediately after creation — there is no wait.

## Fix

Measure the **value**, not the status code. Keep three states, because "I could not tell" is not "no":

```ts
async function folderExists(sp, webUrl, url): Promise<boolean | undefined> {
  const r = await sp.get(`${webUrl}/_api/web/getfolderbyserverrelativeurl('${esc(url)}')?$select=Exists`);
  if (r.status === 404) return false;      // some paths do 404 — still "no"
  if (!r.ok) return undefined;             // 403, throttling, outage — do NOT guess
  const d = await r.json();
  return typeof d.Exists === 'boolean' ? d.Exists : undefined;
}
```

The same shape applies to `ListItemAllFields`: a 200 carrying `{"odata.null": true}` means *there is no item*, so anything you derive from it (`Id`, `HasUniqueRoleAssignments`) is absent rather than false.

## Why it bites hardest around permissions

The usual reason to look a folder up is to give it its own permissions — create the folder, break inheritance, assign principals. That chain has a property worth keeping in mind: **a file uploaded into a folder inherits that folder's ACL at the moment it is created**, which is why per-folder permissions avoid the "uploaded but not yet secured" window that per-item permissions have. Getting the existence check wrong breaks exactly this chain, and the resulting 404 on `breakroleinheritance` sends you looking at ManagePermissions instead of at the folder that was never created.

Make the failure path safe while you are there: if securing the folder fails, whatever flag says "this content is protected" must be turned back **off**. A configuration that claims protection it does not have is worse than no protection, because everything downstream trusts it.

## Related

- [`fields/getbyinternalnameortitle` returns 400, not 404](getbyinternalnameortitle-400-not-404.md) — the same class from the other side: the status code lies about a missing thing.
- [Don't cache a throttled permission probe](dont-cache-a-throttled-permission-probe.md) — "could not tell" must not settle into "allowed".
