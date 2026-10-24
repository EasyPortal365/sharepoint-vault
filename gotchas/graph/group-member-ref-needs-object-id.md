---
title: Adding or removing a group member via Graph needs the object ID — a UPN returns 400 "Invalid object identifier"
short-title: "Group `members/$ref` needs object ID, not UPN"
summary: "`POST /groups/{id}/members/$ref` and `DELETE /groups/{id}/members/{id}/$ref` accept only the user's object ID (GUID); a UPN from a people picker returns 400 Invalid object identifier — resolve it with `GET /users/{upn}?$select=id` first"
tags: [graph, groups, membership, entra-id, spfx, troubleshooting]
applies-to: Microsoft Graph v1.0 (Microsoft Entra ID groups)
last-reviewed: 2026-10-24
---

# Group membership via Graph needs the object ID, not the UPN

> **Bottom line.** `POST /groups/{id}/members/$ref` with `"@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/{id}"` and `DELETE /groups/{id}/members/{id}/$ref` accept **only the object ID (GUID)**. Pass a UPN (what most people pickers return) and Graph answers **400 `Invalid object identifier 'user@contoso.com'`** — even though `GroupMember.ReadWrite.All` is granted. Resolve the UPN first with `GET /users/{upn}?$select=id`.
>
> **Ve zkratce.** Přidání a odebrání člena skupiny přes Graph (`members/$ref`) bere **jen object ID (GUID)**. UPN z výběru osoby vrátí **400 `Invalid object identifier`**, i když je oprávnění `GroupMember.ReadWrite.All` udělené. UPN nejdřív přelož přes `GET /users/{upn}?$select=id`.

## Symptom

An SPFx solution lets an admin pick a person and add them to a security group. The permission request (`GroupMember.ReadWrite.All`) is approved in the SharePoint admin center, yet the write fails:

```
POST https://graph.microsoft.com/v1.0/groups/{groupId}/members/$ref
{ "@odata.id": "https://graph.microsoft.com/v1.0/directoryObjects/user@contoso.com" }

400 Bad Request
Invalid object identifier 'user@contoso.com'.
```

Reads with the same identifier work (`GET /users/user@contoso.com/transitiveMemberOf`), so the bug only appears when you finally write.

## Cause

`/users/{id | userPrincipalName}` accepts both forms, but the `directoryObjects/{id}` reference used by `$ref` resolves **directory objects by object ID only** — a UPN is not an object identifier there (measured on `POST …/members/$ref`). The removal path `DELETE /groups/{id}/members/{id}/$ref` is documented with the directory object ID as well; we resolve the UPN there too rather than rely on undocumented behaviour.

A missing permission looks different: the documentation lists **403 Forbidden** for adding a member you don't have permissions to add, and **400** for input problems (already a member, unsupported member type, a just-created group that hasn't replicated). A 400 right after granting consent points at the input, not at the grant.

## Fix

Translate anything that is not a GUID before writing:

```ts
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function objectId(client: MSGraphClientV3, user: string): Promise<string> {
  if (GUID.test(user)) return user;
  const u = await client.api(`/users/${encodeURIComponent(user)}`).select('id').get();
  if (!u?.id) throw new Error(`User "${user}" not found in Entra ID.`);
  return u.id;
}

// add
await client.api(`/groups/${groupId}/members/$ref`)
  .post({ '@odata.id': `https://graph.microsoft.com/v1.0/directoryObjects/${await objectId(client, user)}` });

// remove
await client.api(`/groups/${groupId}/members/${await objectId(client, user)}/$ref`).delete();
```

Treat 400 "One or more added object references already exist" on add as success (the user is already a member).

## See also

- Microsoft Learn: [Add members](https://learn.microsoft.com/en-us/graph/api/group-post-members?view=graph-rest-1.0) · [Remove member](https://learn.microsoft.com/en-us/graph/api/group-delete-members?view=graph-rest-1.0)

- [`directoryobject-collections-reject-select-and-top.md`](directoryobject-collections-reject-select-and-top.md)
- [`reread-fresh-before-bulk-membership-removal.md`](reread-fresh-before-bulk-membership-removal.md)
