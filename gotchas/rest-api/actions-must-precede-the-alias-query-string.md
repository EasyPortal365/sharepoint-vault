---
title: Actions must go before the alias query string, not after the URL
tags: [rest-api, lists, permissions, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-30
---

# Actions must go before the alias query string, not after the URL

> **Bottom line.** Once you resolve a list with `GetList(@u)?@u='...'`, the URL ends in a **query string** — so appending `/breakroleinheritance(...)` puts the action *inside the parameter value*. The request returns a shrug instead of an error, and whatever you thought you secured was never secured.
>
> **Ve zkratce.** Jakmile seznam adresuješ přes `GetList(@u)?@u='…'`, končí URL **query stringem** – a připojení `/breakroleinheritance(…)` tím vloží akci dovnitř hodnoty parametru. Požadavek neselže hlasitě, jen neudělá nic, a to, co sis myslel, že zabezpečuješ, zabezpečené není.

## Symptom

You switched to resolving lists by URL (see [Get lists by URL, not by title](get-list-by-url-not-by-title.md)) and your permission bootstrap stopped working. No exception in the browser console beyond a warning you wrapped it in. The lists still inherit permissions from the web. Running the same break manually in the UI works fine.

## Cause

The two helper shapes look interchangeable, but they are not:

```
by title:  /_api/web/lists/getbytitle('Docs')          ← path ends here
by URL:    /_api/web/GetList(@u)?@u='/sites/x/Lists/Docs'   ← query string
```

String-concatenating an action onto the second one produces this:

```http
POST /_api/web/GetList(@u)?@u='/sites/x/Lists/Docs'/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)
```

The server sees the resource `GetList(@u)` and an `@u` value of `'/sites/x/Lists/Docs'/breakroleinheritance(...)`. The action is now **data**, not a path segment. Depending on the endpoint you get a 400, or — worse — a 2xx for a call that did nothing you wanted.

Everything after the `?` is parameters. This bites every action segment equally:

- `/breakroleinheritance(...)`
- `/resetroleinheritance`
- `/roleassignments/addroleassignment(principalid=…,roledefid=…)`
- `/roleassignments/removeroleassignment(principalid=…)`
- `/items(1)/AttachmentFiles/add(FileName='x.pdf')`

## Why it hides so well

Three things conspire:

1. **Permission bootstraps are usually wrapped in `try/catch`** — they must not break provisioning for a user who lacks `ManagePermissions`. That same catch swallows a malformed-URL failure.
2. **Failure looks like the normal no-op.** A list that still inherits permissions is exactly what you'd see if the code had correctly decided there was nothing to do.
3. **It works from an admin account in the UI.** Nobody re-checks the REST path once the feature "exists".

A codebase can carry this for a long time while doing it *correctly* elsewhere — the manual splice is easy to get right when you're thinking about it, and easy to forget when you're writing the third call in a loop.

## Fix

Splice the action in **before** `?@u=`:

```typescript
// WRONG — action lands inside the parameter value
const url = `${listBase(webUrl, name)}/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)`;

// RIGHT — action is a path segment, alias stays a parameter
const url = listBase(webUrl, name)
  .replace('?@u=', '/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)?@u=');
```

Resulting in:

```http
POST /_api/web/GetList(@u)/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)?@u='/sites/x/Lists/Docs'
```

**Do not leave this as a manual `.replace()` at each call site.** That is precisely how the inconsistency arises — some calls get it, some don't. Give the alias form a helper that owns the splice, and make the plain base function the one you never concatenate onto:

```typescript
/** List root — safe to GET, never concatenate an action onto this. */
export function listBase(webUrl: string, name: string): string {
  const alias = serverRelPath(webUrl) + '/Lists/' + name;
  return `${webUrl}/_api/web/GetList(@u)?@u='${alias}'`;
}

/** URL for an ACTION on the list. Inserts the segment before the query string. */
export function listActionUrl(webUrl: string, name: string, action: string): string {
  return listBase(webUrl, name).replace('?@u=', '/' + action + '?@u=');
}
```

## How to check whether you already have the bug

Grep for a closing template-literal brace followed by a slash — that is concatenation onto a base URL:

```bash
grep -rnE "listBase\([^)]*\)\}/" src/
```

Then verify the intent actually took effect, rather than trusting the absence of errors:

```http
GET /_api/web/GetList(@u)/HasUniqueRoleAssignments?@u='/sites/x/Lists/Docs'
```

`false` after a break you believe succeeded means the request never did what you think. Assert on **state**, not on the absence of an exception — a permission routine that only logs failures will report success forever.

## Related

- [Get lists by URL, not by title](get-list-by-url-not-by-title.md) — why you end up on the alias form in the first place
- [`writeSecurity: 4` still needs ManageLists](../permissions/write-security-4-needs-managelists.md) — the other reason a list you "secured" is not secured
