---
title: A SharePoint group created by code hides its own membership — and Full Control does not get you in
tags: [security, permissions, groups, provisioning, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-08-17
---

# A SharePoint group created by code hides its own membership

> **Bottom line.** `POST /_api/web/sitegroups` creates the group with `OnlyAllowMembersViewMembership: true` (groups created through the UI get `false`). From then on, only a **member of that group** or its **owner** — the account that ran your provisioning code — can read its membership. Every other administrator gets HTTP 403, and Full Control does not help.
>
> **Ve zkratce.** Skupina založená kódem má „členství vidí jen členové" zapnuté. Členy tak přečte jen člen skupiny nebo její vlastník (účet, který provisioning spustil) — druhý správce dostane 403, a Full Control ho neobejde.

## Symptom

Two administrators open the same admin screen. One sees the group's members. The other sees an empty list — and if the app treats "no rows" as "nobody is in this group", it will happily tell them the group is empty.

The pattern that makes it look random: the second administrator sees the groups they **belong to** just fine. Only the groups they are not a member of come back empty. Nobody suspects permissions, because both accounts are administrators of the same site.

## Cause

`SPGroup.OnlyAllowMembersViewMembership` defaults to `true` for programmatic creation. The membership read (`/_api/web/sitegroups/getbyname('<name>')/users`) is then allowed only for a member of the group or the group's `Owner`, which after provisioning is whichever account happened to run it first.

The trap is that **effective permissions do not decide this**. Measured on a live site, two administrators had byte-identical masks — `High=2147483647`, i.e. Full Control — and one could read the membership while the other could not. The differentiator was ownership and membership, nothing else.

It is also invisible to whoever deploys the app: they own all the groups they just created, so the screen looks perfect on their machine.

## Verify it (read-only)

```javascript
// Run in the browser console on the site. Compare your app's groups with the built-in ones.
const web = location.origin + location.pathname.split('/_layouts')[0].replace(/\/[^/]*\.aspx$/, '');
const r = await fetch(web + "/_api/web/sitegroups?$expand=Owner&$select=Title,OnlyAllowMembersViewMembership,Owner/Title", {
  headers: { Accept: 'application/json;odata=nometadata' }
}).then(x => x.json());
r.value.forEach(g => console.log(g.Title, '| onlyMembers:', g.OnlyAllowMembersViewMembership, '| owner:', g.Owner && g.Owner.Title));
```

Groups your code created will read `true` with a single user as owner; the site's own Owners/Members/Visitors groups will read `false`.

To rule permissions out (or in) for a specific person, compare the masks of both users — note the parameter shape, a doubly-encoded login returns `400 "The query string userName is missing or invalid"`:

```javascript
const login = 'i:0#.f|membership|someone@contoso.com';
await fetch(web + "/_api/web/getusereffectivepermissions(@u)?@u='" + encodeURIComponent(login) + "'",
  { headers: { Accept: 'application/json;odata=nometadata' } }).then(x => x.json());
```

Identical masks plus different visible content means the cause is ownership or membership of the object, not rights.

## Fix

Align the flag right after you resolve the group id. `MERGE` on the group entity, plain JSON — SharePoint infers the type from the URL, so no `__metadata` (which would fail with `400` under `SPHttpClient`, whose v1 configuration sends `odata-version: 4.0`):

```typescript
// Read first, patch only the difference: members lack ManagePermissions and would just
// generate 403 noise on every load.
const check = await spHttpClient.get(
  `${webUrl}/_api/web/sitegroups/getbyname('${encodeURIComponent(name)}')?$select=Id,OnlyAllowMembersViewMembership`,
  SPHttpClient.configurations.v1, { headers: { Accept: 'application/json' } });
const g = await check.json();
if (g.OnlyAllowMembersViewMembership !== false) {
  await spHttpClient.fetch(`${webUrl}/_api/web/sitegroups/getbyid(${g.Id})`, SPHttpClient.configurations.v1, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'IF-MATCH': '*', 'X-HTTP-Method': 'MERGE' },
    body: JSON.stringify({ OnlyAllowMembersViewMembership: false })
  });
}
```

Three things decide whether this fix actually lands:

1. **Do not hang it on a schema-version gate.** Existing deployments already have the groups, so a "create if missing" path never runs again. Make it a separate idempotent step with its own marker, and bump that marker when you change the step — otherwise the sites that need it most are the ones that skip it.
2. **The write needs ManagePermissions.** A regular member gets 403; keep the step fail-safe and let the first administrator's visit do the work. A per-user marker (rather than one stored on the site) is what makes that possible.
3. **Decide it per group, not globally.** Where membership is genuinely sensitive — support queues with item-level security, for instance — `true` is the right value and the UI should stop asking for the member list instead.

## And stop rendering the denial as emptiness

Whatever you decide about the flag, a failed read must not look like an empty group. Return the read status alongside the data:

```typescript
async function getMembers(group: string): Promise<{ ok: boolean; users: ISpUser[] }> {
  const resp = await spHttpClient.get(url, SPHttpClient.configurations.v1, { headers: { Accept: 'application/json' } });
  if (!resp.ok) return { ok: false, users: [] };   // 403 is not "nobody"
  return { ok: true, users: (await resp.json()).value || [] };
}
```

Then say so in the UI: *"Members of this group could not be read — SharePoint returned an error."* A single swallowed 403 rendered as "nobody here yet" is what turns a permissions quirk into a support ticket claiming the app deleted people's roles.

Two things that bite when you retrofit this across an existing codebase:

- **Showing the error is not enough — you must also switch the empty state off.** Two of the screens fixed in one sweep (2026-08-17) already surfaced the failure in a red banner, and directly underneath still rendered "No members" because the condition only tested `members.length === 0`. An error message next to a claim about emptiness is not an honest state; the fix is `!error && members.length === 0`. This class of bug survives code review precisely because "we do show the error" looks finished.
- **Never let a cache remember the failure.** Where membership is cached, only the success path may write to the cache. Otherwise a denied read is pinned for the whole TTL and the banner keeps accusing SharePoint long after the permission is fixed.
- **Keep the wording cause-agnostic.** "Access denied" is a lie on a fresh deployment, where the group does not exist yet and `getbyname` answers 500 (see the sibling note in [`getbyinternalnameortitle-400-not-404`](../rest-api/getbyinternalnameortitle-400-not-404.md)). "SharePoint returned an error (typically access denied)" covers both.

## Related

- [Hiding a field is not a permission](field-hiding-is-not-a-permission.md)
- [A library your app provisions inherits the web's write permissions](app-provisioned-library-inherits-web-write.md)
