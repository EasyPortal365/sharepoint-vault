---
title: Provisioning folder trees at scale in SharePoint Online
tags: [rest-api, permissions, provisioning, guide]
applies-to: SharePoint Online
last-reviewed: 2026-09-11
---

# Provisioning folder trees at scale in SharePoint Online

> **Bottom line.** SharePoint Online will happily create 86 folders with unique permissions from a single browser tab in about half a minute, with no throttling — so batching is an optimisation, not a prerequisite. The three things that *will* bite you are the alias-parameter syntax, walking the tree one folder at a time, and `copyRoleAssignments=false` quietly removing the owners group.
>
> **Ve zkratce.** SharePoint Online zvládne založit 86 složek s vlastními oprávněními z jedné záložky prohlížeče zhruba za půl minuty a bez škrcení – dávkování je tedy optimalizace, ne podmínka. Tři věci, které vás naopak potrápí, jsou syntaxe alias parametru, procházení stromu složku po složce a `copyRoleAssignments=false`, které tiše odebere skupinu vlastníků.

Plenty of solutions need to stamp the same folder structure onto many sites: a project template, a case-file layout, a per-customer workspace. The docs tell you which endpoints exist; they don't tell you what it costs, where the throttling ceiling is, or which of the two obvious approaches is forty-five times cheaper.

We measured it. Everything below comes from a live run against SharePoint Online in September 2026: a freshly created modern team site, an empty default document library, one Chrome tab, sequential calls with no artificial delay. The structure was two levels deep — 18 top-level folders and 68 second-level ones, 86 in total.

## The numbers

| Operation | Calls | Wall time | Avg/call |
|---|---|---|---|
| Read the tree by **walking** it (one request per folder) | 90 | 13.1 s | 144 ms |
| Read the tree with **one item query** | **2** | **0.6 s** | 296 ms |
| Create 86 folders (existence check + add) | 176 | 33.6 s | 186 ms |
| Break inheritance + assign a role on 18 folders | 36 POST | ~6 s | 167 ms |

**Throttling across the whole session: none.** Roughly 480 calls, 125 of them writes, no `429`, no `503`, no `Retry-After` — with zero delay between calls.

That last line is the headline. A lot of provisioning code is built around batching from day one because everyone assumes SharePoint will push back. For a single site it won't. Where batching genuinely earns its keep is fleet-wide work: 500 sites × 34 s is nearly five hours in one tab.

## Trap 1: the alias parameter belongs in the query string

Any path with a space, a comma, a bracket or a diacritic should go through an alias parameter rather than being inlined. Almost everyone writes it wrong the first time:

```js
// ✗ 400 Bad Request — the value is inside the parentheses
`${web}/_api/web/GetFolderByServerRelativePath(decodedurl=@a1='%2Fsites%2Fprojects%2FShared%20Documents')`

// ✓ the alias is *referenced* in the parentheses, its value lives in the query string
`${web}/_api/web/GetFolderByServerRelativePath(decodedurl=@a1)?@a1='%2Fsites%2Fprojects%2FShared%20Documents'`
```

A helper worth having, because you will build these URLs dozens of times:

```js
/** Single quotes inside the value must be doubled, then the whole thing URL-encoded. */
function pathApi(web, op, serverRelUrl, tail = '', query = []) {
  const val = "'" + encodeURIComponent(serverRelUrl.split("'").join("''")) + "'";
  return `${web}/_api/web/${op}(decodedurl=@a1)${tail}?` + ['@a1=' + val, ...query].join('&');
}

// GET the children of a folder
pathApi(web, 'GetFolderByServerRelativePath', libRoot, '/Folders',
        ['$select=Name,ServerRelativeUrl', '$top=500']);
```

The same shape works for `Folders/AddUsingPath(decodedurl=@a1)?@a1='…'`, and you can chain method calls after it — `…(decodedurl=@a1)/ListItemAllFields/breakroleinheritance(copyRoleAssignments=false)?@a1='…'` is a valid URL.

One name SharePoint will never accept, however you encode it: anything containing `" * : < > ? / \ |`, or a name ending in a period. Normalise before you write, and tell the caller what you changed rather than silently mangling it.

## Trap 2: don't walk the tree

The obvious way to read a folder structure is to `GET …/Folders`, then recurse into each child. It works, and it costs one request per folder — 90 requests and 13 seconds for our 86 folders.

Every folder in a library is also a list item with `FSObjType eq 1`. One query returns the lot:

```js
const val = "'" + encodeURIComponent(libServerRelUrl) + "'";
const url = `${web}/_api/web/GetList(@a1)/items?@a1=${val}`
          + `&$filter=FSObjType eq 1&$select=FileRef,FileLeafRef&$top=5000`;
```

Two calls, 0.6 seconds, and — importantly — **the same 88 folders the walk returned**, so the filter isn't quietly dropping anything. Reconstruct the hierarchy from `FileRef`; depth is just the number of slashes after the library root.

Two caveats:

- **Look the list up by URL, not by title.** `GetList('/sites/projects/Shared Documents')` is rename-safe, and the default library is the classic trap: its URL is `Shared Documents` while its title is `Documents`.
- **Keep the walk as a fallback.** `FSObjType` is not indexed, so above the 5 000-item list view threshold the filter fails. Libraries that large are exactly where you need the fallback, so don't delete it.

## Trap 3: `copyRoleAssignments=false` removes the owners too

Breaking inheritance with a clean slate is usually what you want — otherwise the site's default members group keeps its Edit role next to whatever you add, and the stronger one wins.

```js
// clean slate, then grant exactly what the matrix says
await post(pathApi(web, 'GetFolderByServerRelativePath', folder,
  '/ListItemAllFields/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)'));
await post(pathApi(web, 'GetFolderByServerRelativePath', folder,
  `/ListItemAllFields/roleassignments/addroleassignment(principalid=${groupId},roledefid=${roleDefId})`));
```

What the clean slate also removes is the **owners group**. After the break, our folder listed exactly two principals: the group we had just added, and the site collection administrator who ran the script. `<Site> Owners` was gone.

This is nasty precisely because the person testing it never sees it. A site collection administrator has full control implicitly, so the folder looks fine to them. The member of the owners group who can no longer open it is someone else, and they'll find out later.

**Rule: after breaking inheritance, assign the complete set of principals your permission matrix defines — not just the one you were thinking about.** And verify with `getUserEffectivePermissions` for a real non-admin account, not by reading back the role list: the list tells you what is configured, not what follows from it.

### Inheritance below the break still works

Worth knowing before you decide how deep to go: second-level folders inherit from a broken first-level parent. Breaking at the top level creates a permission zone that everything underneath picks up for free.

So unique permissions on the second level are only needed where a specific subfolder must differ from its parent. Applying them everywhere is not a performance problem — 86 breaks cost about 29 seconds — it's a *maintenance* problem: every subsequent role change means walking every folder on every site instead of a handful.

## Three smaller things, while you're here

**`Exists` is in the body, not the status.** Asking about a folder that isn't there returns **200** with `{"Exists": false}`. Code that checks `response.ok` will conclude the folder exists and fail on the next write instead.

```js
const r = await get(pathApi(web, 'GetFolderByServerRelativePath', path, '', ['$select=Exists']));
const exists = r.Exists === true;   // not just r.ok
```

**`_spPageContextInfo` is not a global on modern pages.** Console scripts that reach for it die on line one with a `ReferenceError`. Derive the web URL from `location` instead:

```js
const m = decodeURIComponent(location.pathname).match(/^\/(sites|teams)\/[^/]+/i);
const web = location.origin + (m ? m[0] : '');
```

**Teams channel folders appear on their own schedule.** The folder backing a channel is created during team provisioning with a delay, not synchronously with the channel. Don't assume a freshly created team site's library is empty — or finished — at the moment your script starts writing to it.

## Retry policy, in one line

If you do add retry handling, **retry reads only**. Honouring `Retry-After` on a `GET` is a straight win; doing it on a `POST` that may already have succeeded gets you duplicates. A write that hits `429` should surface as an error and let the caller re-run — which is free if, as above, every create checks existence first.
