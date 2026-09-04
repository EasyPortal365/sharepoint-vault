---
title: An Entra group inside a SharePoint group is invisible to every membership check SharePoint offers
tags: [security, permissions, groups, entra, graph, rest-api]
applies-to: SharePoint Online (site groups containing Entra ID groups; app code that gates on membership)
last-reviewed: 2026-09-04
---

# An Entra group inside a SharePoint group is invisible to every membership check SharePoint offers

> **Bottom line.** SharePoint happily accepts an Entra ID group as a member of a site group, and everything looks right in the UI. But nothing SharePoint tells you about membership expands it: `currentuser/groups` reports only direct membership, and `sitegroups/{id}/users` returns *the group*, not the people in it. Code that gates on membership therefore denies access to exactly the people the admin just granted it to — silently, with a "you don't have permission" message. Resolve nested membership through Graph `POST /me/checkMemberGroups`, and make "couldn't check" a distinct outcome from "not a member".
>
> **Ve zkratce.** SharePoint přijme skupinu Entra ID jako člena skupiny webu a v UI vypadá všechno správně. Jenže žádná informace o členství, kterou SharePoint dává, ji nerozbalí: `currentuser/groups` hlásí jen přímé členství a `sitegroups/{id}/users` vrátí *tu skupinu*, ne lidi v ní. Kód, který podle členství rozhoduje o přístupu, tak odmítne přesně ty lidi, kterým ho správce právě dal – tiše a s hláškou „nemáte oprávnění". Vnořené členství vyhodnoťte přes Graph `POST /me/checkMemberGroups` a „nepodařilo se zjistit" držte odděleně od „není členem".

## Symptom

An administrator adds a department's security group to a site group that your application uses for a role. The group shows up in the members list. Then every member of that group is refused, and the only message they get is about permissions they appear to have. The administrator sees the group in the role and cannot reproduce the problem, because they are usually a direct member too.

## Cause

Three different shapes of the same bug, which is why grepping for one API call does not find it:

| What the code does | What it gets back |
|---|---|
| `GET /_api/web/currentuser/groups` | **Direct membership only.** A nested Entra group never appears here. |
| `GET /_api/web/sitegroups/{id}/users` | The Entra group **as a principal** — one row, with its claim in `LoginName`. Never its members. |
| The same call with `$select=Id,Title,Email` | The group row is still there, but **without `LoginName` it is unrecognisable**, so it gets treated as a strange user account with no mailbox and quietly ignored. |

The third one is the nastiest: the query has no principal-type filter, so it looks innocent in review. Add `LoginName,PrincipalType` to the `$select`.

## Fix

Read the members with the login, pick out the groups, and ask Graph about them:

```ts
// 1. claim shapes SharePoint understands for an Entra group
const SECURITY = 'c:0t.c|tenant|';                            // security group
const M365     = 'c:0o.c|federateddirectoryclaimprovider|';   // Microsoft 365 group
// (a SharePoint group is 'c:0(.s|true' — it cannot be nested and Graph knows nothing about it)

function groupObjectId(loginName: string): string {
  for (const p of [SECURITY, M365]) {
    if (loginName.indexOf(p) === 0) return loginName.substring(p.length).toLowerCase();
  }
  return '';
}

// 2. GUIDs of the groups sitting inside the site group
const ids = members.map(m => groupObjectId(m.LoginName || '')).filter(Boolean);

// 3. ask only about those groups — never read the user's whole membership
//    (max 20 per call; chunk beyond that)
const res = await graph.api('/me/checkMemberGroups').post({ groupIds: ids.slice(0, 20) });
const memberOf: string[] = res.value || [];
```

Requires a delegated permission that covers reading group membership (`GroupMember.Read.All` is the least privileged of the usual set). Note that in SharePoint Framework these grants are made to one tenant-wide service principal, so an app can end up *using* a scope it never requested — which works in your own tenant and fails at a customer where no deployed package requested it. Declare the scope anyway.

## The part everybody gets wrong

**A failed check is not a negative answer.** If the consent is missing, the token is stale, or Graph is briefly unavailable, the natural shape of this code returns an empty set — indistinguishable from "this person is genuinely not a member". Return the outcome as a type instead:

```ts
interface MembershipResult { ok: boolean; memberOf: string[]; }
```

- `ok: true, memberOf: []` → an **answer**: deny, and say "you don't have permission".
- `ok: false` → a **fault**: still deny, but say **"we couldn't verify your membership"**.

Collapsing the two means that during a Graph outage your application throws the administrator out of their own settings screen and tells them they never belonged there. Also: **do not cache a failure.** Caching the empty result pins "not a member" in place for the lifetime of the cache, long after the outage ends. Cache positive and negative *answers*; never faults.

## Notes

- **Don't guess the claim when adding a group.** The GUID does not tell you whether the group is a security group or a Microsoft 365 group, and the wrong prefix is written **without an error** — creating a principal nobody will ever match. Carry the claim from whatever picker produced the selection (`ClientPeoplePickerSearchUser` returns it in `Key`), or try both forms and let the server decide. Once written, it no longer matters which shape won: comparison happens on the GUID.
- **Compare GUIDs case-insensitively.** Graph returns ids lower-cased; people-picker payloads carry `EntityData.ObjectId` upper-cased on some tenants, and that is the form that ends up stored. A byte-wise comparison then silently fails to match.
- SharePoint groups cannot be nested into other SharePoint groups, so don't offer them in a picker meant for this — they would be written successfully and never resolve.
- Related: [Checking someone else's group membership](../graph/check-membership-of-another-user-without-user-read-all.md) — `checkMemberGroups` only ever answers for the signed-in user; for "what can this colleague see?" ask the group instead.
