---
title: A comma in a Graph permissions table can mean AND — searching Teams messages needs two scopes
tags: [graph, permissions, search, teams]
applies-to: Microsoft Graph Search API (v1.0), Teams messages
last-reviewed: 2026-09-24
---

# A comma in a Graph permissions table can mean AND

> **Bottom line.** The Search API overview lists `chatMessage` with "Chat.Read, Chat.ReadWrite, ChannelMessage.Read.All", which reads like three alternatives. It is not: searching Teams messages needs `Chat.Read` (or `Chat.ReadWrite`) **and** `ChannelMessage.Read.All` — even when you only want chats. Treat a permissions table as a list of candidates and let a real call tell you the requirement; the 403 spells it out.
>
> **Ve zkratce.** Přehled Search API uvádí u `chatMessage` „Chat.Read, Chat.ReadWrite, ChannelMessage.Read.All“, což se čte jako tři alternativy. Nejsou: hledání ve zprávách Teams potřebuje `Chat.Read` (nebo `Chat.ReadWrite`) **a zároveň** `ChannelMessage.Read.All` – i když chceš jen chaty. Tabulku oprávnění ber jako seznam kandidátů a skutečný požadavek si nech říct voláním; hláška 403 ho vypíše přesně.

## Symptom

You grant `Chat.Read`, the first permission in the row, and call `POST /search/query` with `entityTypes: ["chatMessage"]`:

```
403 Forbidden: Access to ChatMessage in Graph API requires the following permissions:
Chat.Read or Chat.ReadWrite, ChannelMessage.Read.All. However, the application only has …
```

## Cause

The overview table packs the whole requirement into one comma-separated cell and does not say which commas mean "or" and which mean "and". The runtime message is precise: `(Chat.Read | Chat.ReadWrite) AND ChannelMessage.Read.All`.

The expensive part is what can happen before anyone sees the 403: reading the cell as "`Chat.Read` covers chats, `ChannelMessage.Read.All` adds channels", shaping the UI around that inference ("channels need an extra permission"), and writing it down as a fact. Only the live 403 corrected it.

## Fix

- Request both scopes for `chatMessage` search.
- Treat every permissions table as a **list of candidates, not a specification of coverage**, and confirm the requirement with a call whose token carries exactly the scopes you plan to ship.
- Keep inferences from documentation out of your notes until a call has confirmed them.

## Related trap from the same endpoint: `webUrl` vs `webLink`

From the same endpoint, `chatMessage` hits carry their link in `webUrl`, while `message` and `event` hits carry `webLink`. Read both (`resource.webLink || resource.webUrl`), or the result cards of one type silently lose their links. A unified endpoint does not mean a unified schema of the resources it returns.

"Same endpoint" means separate requests, not one response. The overview's *Known limitations* table allows `chatMessage` only on its own, and the same for `message` and `event` — so one request per entity type is the safe shape. The [interleaving page](https://learn.microsoft.com/en-us/graph/search-concept-interleaving) disagrees for `message` + `chatMessage` (it allows the pair, and its example shows `webLink` on a `chatMessage` hit), which is one more reason to read both fields.

## References

- [Use the Microsoft Search API to query data](https://learn.microsoft.com/en-us/graph/api/resources/search-api-overview) — the "Scope search based on entity types" table
- [Graph Search returns 0 hits — you passed the question as the `queryString`](../search/graph-search-raw-question-returns-nothing.md) — the next trap on the same path
