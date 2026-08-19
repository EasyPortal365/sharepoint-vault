---
title: A mail-permission probe that can't tell "no mailbox" from "no consent" lies to admins
tags: [graph, mail, consent, permissions, exchange, diagnostics]
applies-to: Microsoft Graph (/me/messages, delegated), SPFx AadHttpClient
last-reviewed: 2026-08-19
---

# A mail-permission probe that can't tell "no mailbox" from "no consent" lies to admins

> **Bottom line.** Probing a Graph mail permission with `GET /me/messages?$top=1` returns a 404 (`MailboxNotEnabledForRESTAPI`) on accounts without an Exchange Online mailbox — typically admin/cloud-only accounts. If your probe treats every non-200 as "consent missing", the admin who just granted the permission stares at a message telling them to grant it. Distinguish three outcomes: 401/403 = consent missing (hint: refresh after approval — the old token doesn't carry the new scope), 404 + `MailboxNotEnabled*` error code = account has no mailbox (a stable account property, different message), anything else = temporary failure (assert nothing). And **never cache a negative probe result** — only stable states (granted / no-mailbox) may be cached.
>
> **Ve zkratce.** Sonda mailového oprávnění přes `GET /me/messages?$top=1` vrací na účtech bez schránky Exchange Online (typicky admin účty) 404 `MailboxNotEnabledForRESTAPI`. Pokud sonda bere každý ne-200 jako „chybí souhlas", správce, který souhlas právě udělil, čte hlášku, ať ho udělí. Rozlišujte tři stavy: 401/403 = chybí souhlas (s dovětkem „po schválení obnovte stránku" – starý token nový scope nemá), 404 s kódem `MailboxNotEnabled*` = účet bez schránky (trvalá vlastnost účtu, jiná hláška), ostatní = dočasné selhání (netvrdit nic). A **negativní výsledek sondy nikdy necachujte** – cache smí držet jen stabilní stavy.

## Symptom

Your app offers "send as attachment" behind a tenant-approved Graph permission (e.g. `Mail.ReadWrite`). To decide whether to enable the option, it probes:

```
GET https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=id
```

The admin approves the permission in the SharePoint API access page, reopens the dialog — and it still says *"Requires a one-time admin approval."* Nothing they do fixes it.

Two independent causes produce exactly this lie:

1. **The probe ran before approval and the negative result was cached** (in the original bug: for 24 hours in `localStorage`). Every dialog open within the TTL repeats the stale verdict.
2. **The account has no Exchange Online mailbox.** Admin and cloud-only accounts without an Exchange license fail the probe with HTTP 404:

```json
{ "error": { "code": "MailboxNotEnabledForRESTAPI",
             "message": "The mailbox is either inactive, soft-deleted, or is hosted on-premise." } }
```

A probe that collapses everything non-200 into "consent missing" reports the wrong cause with full confidence — the message even names the consent page, sending the admin to re-approve something that is already approved.

## Fix

```ts
const r = await client.get(GRAPH + '/v1.0/me/messages?$top=1&$select=id', config);
if (r.ok) { cache('granted'); return 'granted'; }
if (r.status === 401 || r.status === 403) return 'missing';       // do NOT cache
const body = await r.json().catch(() => undefined);
const code = (body?.error?.code || '').toLowerCase();
if (code.includes('mailboxnotenabled') || code.includes('mailboxnothosted')) {
  cache('no-mailbox');                                            // stable account property
  return 'no-mailbox';
}
return 'error';                                                    // assert nothing, do NOT cache
```

- **Three user-facing messages, not one:** consent missing ("after approval, refresh the page — an older sign-in doesn't know about the new permission"), no mailbox ("this account has no Exchange Online mailbox — a draft with an attachment cannot be created from it"), and a neutral "could not verify right now".
- **Cache only stable states.** `granted` and `no-mailbox` are properties that survive a day; `missing` flips the moment an admin clicks approve. Caching it turns a one-time race into a day-long lie.
- The refresh hint matters: after consent is granted, the SPFx `AadHttpClient` may still hold a token issued *before* the grant, so even a correct probe returns 403 until the page reloads and a fresh token is acquired.

## Related

The same "no mailbox ≠ no permission" trap exists for Microsoft To-Do: `GET /me/todo/lists` returns 404 "Item not found" on mailbox-less accounts even with `Tasks.ReadWrite` consented — while Planner (group-based, no mailbox needed) works fine on the same account.
