---
title: "`accountEnabled eq false` is not a list of leavers — shared mailboxes are disabled on purpose"
short-title: Disabled accounts include shared mailboxes
summary: "blocked members ≠ former employees; tell shared mailboxes apart via the mailbox usage report's `recipientType` — impossible when report names are concealed"
tags: [graph, entra-id, users, reports, shared-mailbox, offboarding]
applies-to: Microsoft Graph v1.0 and beta (users, reports), Exchange Online
last-reviewed: 2026-11-06
---

# `accountEnabled eq false` is not a list of leavers

> **Bottom line.** A report of "blocked accounts that still hold data" built on `GET /users?$filter=accountEnabled eq false` also lists every **shared mailbox** (`support@`, `info@`, `noreply@`). Exchange creates their Entra user objects with sign-in disabled — they are blocked on purpose, are `userType: Member`, and look exactly like a departed colleague. Graph's user object has no property that says "this is a shared mailbox". Use `getMailboxUsageDetail` (its `recipientType` is `Shared` or `User`) to exclude them — but only when usage reports show real names; with concealed names the report can't be joined to users, so say so instead of guessing.
>
> **Ve zkratce.** Seznam „zablokovaných účtů s daty“ postavený na `GET /users?$filter=accountEnabled eq false` obsahuje i každou **sdílenou schránku** (`support@`, `info@`, `noreply@`). Exchange jí v Entra zakládá uživatele se zakázaným přihlášením – je zablokovaná záměrně, má `userType: Member` a vypadá přesně jako kolega, který odešel. Objekt uživatele v Graphu žádnou vlastnost „tohle je sdílená schránka“ nemá. Vyřaďte je podle sestavy `getMailboxUsageDetail` (`recipientType` je `Shared` nebo `User`) – ale jen když sestavy ukazují skutečná jména; se skrytými jmény sestavu k uživatelům nespárujete, tak to řekněte, místo hádání.

## Symptom

An offboarding / "OneDrive of people who left" screen lists `support@contoso.com` and "Helpdesk" as *former colleague – blocked*, next to real leavers. An admin following the list would start "handing over" a mailbox that is in active use.

## Why

- A shared mailbox has no own sign-in; Exchange backs it with an Entra user whose `accountEnabled` is `false`. It is a member and has a UPN — nothing on `/users` distinguishes it.
- Room and equipment mailboxes are disabled the same way. Whether they show up in the mailbox usage report at all is not documented (the documented recipient types are only `Shared` and `User`), so don't promise to exclude them unless you have checked in your tenant.
- The authoritative property (`RecipientTypeDetails = SharedMailbox`) lives in Exchange (`Get-EXOMailbox`), which a browser app can't call.

## Fix

```http
GET https://graph.microsoft.com/beta/reports/getMailboxUsageDetail(period='D7')?$format=application/json
```

Needs `Reports.Read.All` (plus a reports-reader role for delegated calls). Build a set of UPNs whose `recipientType` is not `User` and drop those from the disabled-accounts list.

```js
const nonPersonal = new Set(
  rows.filter(r => (r.recipientType || '').toLowerCase() !== 'user')
      .map(r => (r.userPrincipalName || '').toLowerCase()));
const leavers = disabledMembers.filter(u => !nonPersonal.has(u.userPrincipalName.toLowerCase()));
```

Treat the report as optional: if it fails (403, throttling) keep all disabled accounts and tell the reader the list may include shared mailboxes.

## Concealed names break the join

By default Microsoft 365 hides user details in usage reports — `userPrincipalName` comes back as an opaque hash, so the report can no longer be matched to `/users`. Detect it (no UPN contains `@`) and don't filter at all; show a note that blocked accounts may include shared mailboxes and where to turn real names on (Microsoft 365 admin center → Settings → Org settings → Reports).

## Related

- [ApplicationAccessPolicy rejects a shared mailbox](application-access-policy-rejects-shared-mailbox.md) — the same disabled account is why it "isn't a security principal".
- [Usage reports in the browser — use beta JSON](usage-reports-cors-blocked-in-browser.md) — why the call above uses beta `?$format=application/json`.
