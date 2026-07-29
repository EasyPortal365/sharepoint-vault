---
title: Checking someone else's group membership — ask the group, not the user
tags: [graph, groups, permissions, delegated]
applies-to: Microsoft Graph (delegated)
last-reviewed: 2026-07-29
---

# "Is *that* person in this group?" without asking for a new permission

> **Symptom.** You need the group membership of a **different** user (an admin tool: "show me what this colleague can see"). `POST /me/checkMemberGroups` only ever answers for the signed-in user, and the obvious replacement — `POST /users/{id}/checkMemberGroups` — needs a directory-read permission your app may not have.
>
> **Cause.** The per-user membership endpoints are scoped to reading *that user's* directory object. `GroupMember.Read.All`, which many apps already hold, grants reading **group** objects and their members — not arbitrary user objects.
>
> **Fix.** Invert the question. Instead of "which groups is this user in?", ask "is this user among the members of the groups I care about?" — you already know which groups matter (they're the ones your rules reference), and members of a group are readable with `GroupMember.Read.All`.

```
GET /groups/{group-id}/transitiveMembers/microsoft.graph.user
    ?$select=id,userPrincipalName,mail&$top=999
```

Page through `@odata.nextLink` and match the person by UPN (fall back to `mail`). `transitiveMembers` also catches nested-group membership, which `members` would miss.

## Three things that bite

**1. The cast is what makes `$select`/`$top` legal here.** Member collections are `directoryObject` collections, where selecting user properties is a 400. With the `/microsoft.graph.user` cast this specific endpoint accepts cast + `$select` + `$top` — but the same recipe on `/directoryRoles/{id}/members` still returns `400 Request_UnsupportedQuery` for `$top`. Verify per endpoint; don't generalise.

**2. You are trading one call for N.** One `checkMemberGroups` becomes one paged read per group. Fine for a handful of rule-bound groups, wasteful for "all groups in the tenant". Cap the number of pages you will walk.

**3. Hitting the cap is not "not a member".** If you stop paging early, or a call fails, the honest answer is *unknown*. Returning `false` silently turns a partial read into a confident wrong answer — the worst outcome for a permissions tool. Keep three states (yes / no / could-not-determine) and surface the third in the UI.

```js
async function isMemberOf(client, groupId, upn, maxPages = 12) {
  let path = `/groups/${encodeURIComponent(groupId)}/transitiveMembers/microsoft.graph.user`
           + '?$select=id,userPrincipalName,mail&$top=999';
  for (let page = 0; page < maxPages; page++) {
    let res;
    try { res = await client.api(path).get(); }
    catch (e) { return null; }                 // unknown — never false
    const hit = (res.value || []).some(u =>
      (u.userPrincipalName || '').toLowerCase() === upn ||
      (u.mail || '').toLowerCase() === upn);
    if (hit) return true;
    if (!res['@odata.nextLink']) return false;
    path = res['@odata.nextLink'];
  }
  return null;                                 // ran out of pages — still unknown
}
```

## Related

- Effective SharePoint permissions for another user, without their password: `snippets/rest/check-another-users-effective-permissions.md`
- `$select` and `$top` traps on directoryObject collections: `gotchas/graph/directoryobject-collections-reject-select-and-top.md`
