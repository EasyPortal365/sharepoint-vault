---
title: A Teams message your app posts in the user's name never notifies that user — and "I can't see it" needs a read-back, not a guess
short-title: Teams message sent as the user doesn't notify the sender
summary: "Delegated `ChatMessage.Send` delivers (even to the self chat `48:notes`), but Teams never alerts the sender; verify with GET + `webUrl`, notify from the app"
tags: [graph, teams, chatmessage, adaptive-cards, notifications, spfx]
applies-to: Microsoft Graph v1.0 (delegated ChatMessage.Send / ChannelMessage.Send), Microsoft Teams, SPFx
last-reviewed: 2026-11-10
---

# A Teams message posted in the user's name never notifies that user

> **Bottom line.** When your app posts to Teams with a **delegated** token (`POST /chats/{id}/messages`, `ChatMessage.Send`), the message is authored by the signed-in user. Teams treats it as *their own* message: it lands in the chat but **doesn't ring, badge or toast for them** (measured in the self chat; it's the same rule as for any message you type yourself). The user's chat with themselves (`48:notes`) accepts the POST and shows the card, even though we found no Microsoft Learn page documenting that id. If a user says "the card didn't arrive", read the message back and hand them its `webUrl` before you debug delivery; if they need an alert, raise it from your app.
>
> **Ve zkratce.** Zpráva, kterou appka pošle do Teams s **delegovaným** tokenem (`ChatMessage.Send`), je zprávou přihlášeného uživatele – Teams ji doručí, ale **jemu samotnému nezazvoní ani neblikne** (změřeno v chatu se sebou; stejně jako u zprávy, kterou napíše sám). Chat se sebou `48:notes` POST přijme a kartu zobrazí, přestože jsme to id v dokumentaci Microsoft Learn nenašli. Když uživatel hlásí „karta nepřišla“, zprávu nejdřív zpětně přečtěte a dejte mu její `webUrl`; upozornění pak musí dát appka sama.

## Symptom

An SPFx web part sends an Adaptive Card to the user's self chat:

```http
POST https://graph.microsoft.com/v1.0/chats/48:notes/messages
{ "body": { "contentType": "html", "content": "<attachment id=\"x\"></attachment>" },
  "attachments": [{ "id": "x", "contentType": "application/vnd.microsoft.card.adaptive", "content": "{...}" }] }
```

Graph answers `201 Created`, the app says "sent" — and the user reports they don't see anything in Teams. Nothing blinks in the chat list, no toast, no activity.

## What is actually going on

1. **Delivery works.** `GET /chats/48:notes/messages/{id}` returns the message right after the POST, and the POST response carries a `webUrl` (`https://teams.microsoft.com/l/message/48:notes/<id>`). Opening it shows the rendered card.
2. **No alert is by design.** The message's `from` is the signed-in user. Teams doesn't alert you about messages you authored — measured in the self chat. In a group chat or channel expect the same for the sender (not measured here).
3. So "I can't see it" usually means "I didn't get an alert, so I looked in the wrong place".

## Fix

- **Verify instead of guessing.** For a test send, read the message back (`GET .../messages/{id}`) and show the user the `webUrl` as an "Open in Teams" link. `201` alone only tells you Graph accepted the request.
- **Notify from your app, not from Teams.** If the app is open while it sends (SPFx usually is), use the browser's `Notification` API: ask for permission only from a click, skip it inside the Teams host, skip it when the page is visible and focused, and open the `webUrl` on click.
- Teams activity-feed notifications (`sendActivityNotification`) need a Teams app whose manifest `webApplicationInfo` points at your own Entra app, installed for the user. SPFx Graph calls go through a shared SharePoint principal, so this is **not verified** to work from SPFx — prototype before you promise it.

## See also

- [Send chatMessage in a chat](https://learn.microsoft.com/graph/api/chat-post-messages)
- [Send activity feed notifications](https://learn.microsoft.com/graph/teams-send-activityfeednotifications)
