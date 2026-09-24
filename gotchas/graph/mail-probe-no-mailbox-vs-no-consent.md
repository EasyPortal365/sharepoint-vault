---
title: A mail-permission probe that can't tell "no mailbox" from "no consent" lies to admins
summary: "`/me/messages` 404 `MailboxNotEnabled*` on mailbox-less accounts ≠ missing consent; three verdicts, and never cache a negative probe result"
tags: [graph, mail, consent, permissions, exchange, licensing, diagnostics]
applies-to: Microsoft Graph (/me/messages, /me/chats, /me/todo/lists, delegated), SPFx AadHttpClient
last-reviewed: 2026-09-22
---

# A mail-permission probe that can't tell "no mailbox" from "no consent" lies to admins

> **Bottom line.** Probing a Graph mail permission with `GET /me/messages?$top=1` returns a 404 (`MailboxNotEnabledForRESTAPI`) on accounts without an Exchange Online mailbox — typically admin/cloud-only accounts. If your probe treats every non-200 as "consent missing", the admin who just granted the permission stares at a message telling them to grant it. Distinguish four outcomes: 401/403 = consent missing (hint: refresh after approval — the old token doesn't carry the new scope), **403 whose message mentions a licence** = the account has no Microsoft 365 licence for that workload (same status as missing consent, only the text tells them apart), 404 (including `MailboxNotEnabled*`) = the resource does not exist for this account — missing consent shows up as a refusal, never as not-found, anything else = temporary failure (assert nothing). And **never cache a negative probe result** — only stable states (granted / no-licence / no-mailbox / no-resource) may be cached.
>
> **Ve zkratce.** Sonda mailového oprávnění přes `GET /me/messages?$top=1` vrací na účtech bez schránky Exchange Online (typicky admin účty) 404 `MailboxNotEnabledForRESTAPI`. Pokud sonda bere každý ne-200 jako „chybí souhlas“, správce, který souhlas právě udělil, čte hlášku, ať ho udělí. Rozlišujte čtyři stavy: 401/403 = chybí souhlas (s dovětkem „po schválení obnovte stránku“ – starý token nový scope nemá), **403, jehož text mluví o licenci** = účtu chybí licence pro danou službu (stejný status jako chybějící souhlas, rozliší je jen text), 404 (včetně `MailboxNotEnabled*`) = zdroj pro tenhle účet neexistuje – chybějící souhlas se projeví odmítnutím, nikdy nenalezením, ostatní = dočasné selhání (netvrdit nic). A **negativní výsledek sondy nikdy necachujte** – cache smí držet jen stabilní stavy (uděleno / bez licence / bez schránky / zdroj neexistuje).

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

3. **The account has no licence for the workload.** This one is the nastiest, because it arrives as **403** — the same status that means "no consent". Probing `GET /me/chats?$top=1` with an unlicensed account returns:

```json
{ "error": { "code": "Forbidden",
             "message": "Failed to get license information for the user. Ensure user has a valid Office365 license assigned to them." } }
```

Nothing in the status distinguishes it from a missing grant. A probe that branches on the status alone tells the admin to approve a permission they approved long ago — and no amount of re-approving will change the result, because the fix is a licence assignment, not a consent.

A probe that collapses everything non-200 into "consent missing" reports the wrong cause with full confidence — the message even names the consent page, sending the admin to re-approve something that is already approved.

## Fix

```ts
const r = await client.get(GRAPH + '/v1.0/me/messages?$top=1&$select=id', config);
if (r.ok) { cache('granted'); return 'granted'; }
const body = await r.json().catch(() => undefined);
const code = (body?.error?.code || '').toLowerCase();
const msg  = (body?.error?.message || '').toLowerCase();

// Licence first: it arrives as 403, so a status-only branch would call it "no consent".
if (msg.includes('license') || msg.includes('licence')) {
  cache('no-licence');                                            // stable account property
  return 'no-licence';
}
if (r.status === 401 || r.status === 403) return 'missing';       // do NOT cache
if (code.includes('mailboxnotenabled') || code.includes('mailboxnothosted')) {
  cache('no-mailbox');                                            // stable account property
  return 'no-mailbox';
}
// 404 is never about consent: a missing grant is refused, not "not found".
if (r.status === 404) { cache('no-resource'); return 'no-resource'; }
return 'error';                                                    // assert nothing, do NOT cache
```

- **Four user-facing messages, not one:** consent missing ("after approval, refresh the page — an older sign-in doesn't know about the new permission"), no licence ("this account has no Microsoft 365 licence for this workload — ask for one, or sign in with a licensed account; it says nothing about the approval"), no mailbox ("this account has no Exchange Online mailbox — a draft with an attachment cannot be created from it"), and a neutral "could not verify right now".
- **Say what each outcome does NOT prove.** "No licence", "no mailbox" and "not found" all leave the consent question unanswered — the message has to say so, or the admin reads a grey row as a red one and goes hunting for a grant that is already in place.
- **Cache only stable states.** `granted` and `no-mailbox` are properties that survive a day; `missing` flips the moment an admin clicks approve. Caching it turns a one-time race into a day-long lie.
- The refresh hint matters: after consent is granted, the SPFx `AadHttpClient` may still hold a token issued *before* the grant, so even a correct probe returns 403 until the page reloads and a fresh token is acquired.

## Related

The same "no mailbox ≠ no permission" trap exists for Microsoft To-Do: `GET /me/todo/lists` returns 404 "Item not found" on mailbox-less accounts even with `Tasks.ReadWrite` consented — while Planner (group-based, no mailbox needed) works fine on the same account.

The licence variant bites hardest on Teams paths (`/me/chats`, channel messages), where an unlicensed admin account gets the 403 above. If you build an admin-facing screen that reports permission status, run it once with an unlicensed, mailbox-less account before shipping: that account hits three of the four branches at once, and any branch you got wrong shows up immediately.
