---
title: Reading Teams channel messages needs a Teams license — a Global Admin without one gets 403 even as a team member
short-title: Channel messages need a Teams license on the reader
summary: "Delegated `GET /teams/{id}/channels/{id}/messages` returns 403 'Failed to get license information for the user' for an unlicensed account even with ChannelMessage.Read.All consented and team membership; a licensed member gets 403 UnknownError on a private channel it is not in; `allChannels` still lists channels of teams the admin is not a member of"
tags: [graph, microsoft-teams, channels, licensing, delegated-permissions, 403]
applies-to: Microsoft Graph v1.0 (/teams/{id}/channels/{id}/messages, /teams/{id}/allChannels, /groups/{id}/members/$ref), delegated permissions
last-reviewed: 2026-10-31
---

# Reading Teams channel messages needs a Teams license on the reader

> **Bottom line.** With delegated `ChannelMessage.Read.All` consented, an account **without a Teams license** gets **403** on every channel's messages — including teams it is a member of. The permission and the membership are not enough; the signed-in reader needs a license that includes Teams. Listing channels is different: `GET /teams/{id}/allChannels` returned the channels of a team the (Global Admin) account was **not** a member of.
>
> **Ve zkratce.** S delegovaným `ChannelMessage.Read.All` dostane účet **bez licence Teams** u zpráv každého kanálu **403** – i v týmech, kde je členem. Oprávnění ani členství nestačí; přihlášený čtenář potřebuje licenci, která obsahuje Teams. Výpis kanálů se chová jinak: `GET /teams/{id}/allChannels` vrátil kanály i týmu, kde účet (globální správce) členem **nebyl**.

## Symptom

```http
GET https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages?$top=5
Authorization: Bearer <delegated token, scp contains ChannelMessage.Read.All>

HTTP/1.1 403 Forbidden
{ "error": { "code": "Forbidden",
  "message": "Failed to get license information for the user. Ensure user has a valid ..." } }
```

Measured on a live tenant with a Global Administrator account that has no Teams license: the same 403 in all six teams, five of which the account was a member of.

## What still works

```http
GET https://graph.microsoft.com/v1.0/teams/{team-id}/allChannels?$select=id,displayName,membershipType
HTTP/1.1 200 OK
```

It returned the channels of a team the account was not a member of. Microsoft documents this as "admin permissions" for Teams service admins on the channel list APIs. A **private channel** the admin is not a member of is listed too (name and `membershipType`), in both `allChannels` and `channels`; its `/members` returns 403.

## A licensed member gets a vague 403 on private channels

A second measurement with a **licensed** account that is a member of every team: all standard channels returned `200 OK`, but a private channel the account had left returned:

```http
HTTP/1.1 403 Forbidden
{ "error": { "code": "UnknownError", "message": "" } }
```

Nothing in the error says "not a member". Interpret a 403 on a private or shared channel by the channel's `membershipType`, not by the error text. Not measured: a licensed account that is not a member of the team at all.

## What to do

- If a tool reads channel messages on behalf of the signed-in user, run it under an account **with a Teams license**, and tell the user exactly that when the 403 says "license information" — do not show it as "access denied" or "not a member".
- Treat a 403 on a `private` or `shared` channel as "not a member of the channel" and say so; only the channel owner (or `ChannelMember.ReadWrite.All`) can add the account.
- To add a check account to teams, `POST /groups/{id}/members/$ref` works with `GroupMember.ReadWrite.All`; `/teams/{id}/members` needs `TeamMember.ReadWriteNonOwnerRole.All` instead.
- Build the "not read" list from `allChannels`: it works without membership, so you can report every channel you could not read, with a reason.
- Do not plan on "one E5 license" to get Purview DLP for Teams across the tenant: Microsoft requires a license for every user who benefits — for channel messages, the team's owners and members (Microsoft Purview service description, "Which users need a license?").

## Sources

- [List channels — admin permissions note](https://learn.microsoft.com/graph/api/channel-list)
- [Add member to group](https://learn.microsoft.com/graph/api/group-post-members)
- [Add member to team](https://learn.microsoft.com/graph/api/team-post-members)
- [Data loss prevention and Microsoft Teams — licensing](https://learn.microsoft.com/purview/dlp-microsoft-teams#dlp-licensing-for-microsoft-teams)
- [Microsoft Purview service description — which users need a license](https://learn.microsoft.com/office365/servicedescriptions/microsoft-365-service-descriptions/microsoft-365-tenantlevel-services-licensing-guidance/microsoft-purview-service-description#which-users-need-a-license)
