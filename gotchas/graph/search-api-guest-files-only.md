---
title: Graph Search API for a guest — only file entity types, everything else is a 400
short-title: "Guest search: files only"
summary: "A guest's /search/query for chatMessage, message, event or person fails with 400 \"Guest access is only supported for File entity types\" — not a consent or licence problem; skip those sources for guests or explain it"
tags: [graph, search, guest, b2b, teams, mail, calendar]
applies-to: Microsoft Graph Search API (delegated, signed-in guest / B2B user)
last-reviewed: 2026-11-19
---

# Graph Search API for a guest: only file entity types

> **Bottom line.** When the signed-in user is a guest (B2B) in the tenant, `POST /search/query` works for files (`driveItem`, `listItem`, `site`, `list`, `drive`) but fails for `chatMessage`, `message`, `event`, `person` and the answer types with **400 BadRequest "SearchRequest Invalid (Guest access is only supported for File entity types. Please remove other entity types from your request.)"**. It is a documented platform limitation — no admin consent, licence or retry fixes it. Detect the message and tell the user plainly, or don't offer those sources to guests at all.
>
> **Ve zkratce.** Host (B2B) smí přes Graph Search prohledávat jen soubory. Chaty Teams, pošta, kalendář i lidé vrátí 400 „Guest access is only supported for File entity types“. Není to souhlas správce ani licence – je to omezení platformy. Hlášku rozpoznej a řekni ji lidsky, nebo hostům tyto zdroje nenabízej.

## Symptom

An app that searches several Microsoft 365 sources on the user's behalf (an AI assistant, a unified search box) works for members, but for one account the Teams-chat source always fails:

```
HTTP 400 · BadRequest: SearchRequest Invalid (Guest access is only supported
for File entity types. Please remove other entity types from your request.)
```

The same account searches SharePoint/OneDrive files fine. Because the call is a delegated Graph call with `Chat.Read` / `Mail.Read` / `Calendars.Read` consented, the first suspicion is consent or a missing Teams licence — both are wrong.

## Cause

Microsoft documents it in the Search API known limitations: *guest search doesn't support searches for acronym, bookmark, message, chatMessage, event, person, qna, or externalItem* ([Search API overview — Known limitations](https://learn.microsoft.com/graph/api/resources/search-api-overview?view=graph-rest-1.0#known-limitations), item 7). A guest also usually has no mailbox in the resource tenant, so mail and calendar would be empty anyway.

## What to do

- **Classify the error by its text, not by status.** A 400 normally means "your request is wrong"; here it means "this account can't search this source". Match `Guest access is only supported for File entity types` and show a human sentence, e.g. *"This is a guest account from another organization — Microsoft 365 lets guests search only files, not Teams chats, mail or calendar."*
- **Don't send generic consent advice** ("ask your admin to approve Chat.Read") for this error — it sends the admin hunting for a problem that doesn't exist.
- **Optionally skip non-file entity types up front for guests** (user principal name contains `#EXT#`, or `userType eq 'Guest'` from `/me?$select=userType`) and grey out those sources with the same explanation.
- **Keep file search on.** Files still work for the guest, limited by the SharePoint permissions they were given.

## Related

- [`/me/todo` needs an Exchange mailbox — guests get an empty 401](todo-requires-exchange-mailbox.md)
- [Mail probe: no mailbox vs. no consent](mail-probe-no-mailbox-vs-no-consent.md)
