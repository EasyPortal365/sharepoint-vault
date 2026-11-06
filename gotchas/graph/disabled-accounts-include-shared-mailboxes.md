---
title: "`accountEnabled eq false` is not a list of leavers — blocked shared mailboxes are in it too"
short-title: Disabled accounts include shared mailboxes
summary: "blocked members ≠ former employees; tell shared mailboxes apart via the mailbox usage report's `recipientType` (needs real names) or `mailboxSettings.userPurpose` (per user)"
tags: [graph, entra-id, users, reports, shared-mailbox, offboarding]
applies-to: Microsoft Graph v1.0 and beta (users, reports, mailboxSettings), Exchange Online
last-reviewed: 2026-11-06
---

# `accountEnabled eq false` is not a list of leavers

> **Bottom line.** A report of "blocked accounts that still hold data" built on `GET /users?$filter=accountEnabled eq false` also lists **shared mailboxes** (`support@`, `info@`, `noreply@`) whose sign-in the admin blocked — which Microsoft recommends doing for every shared mailbox. They are `userType: Member`, have a UPN and look exactly like a departed colleague; the user object itself has no "this is a shared mailbox" property. Tell them apart with the mailbox usage report (`getMailboxUsageDetail`, `recipientType` is `Shared` or `User`) — which only works when usage reports show real names — or per user with `mailboxSettings.userPurpose`. If neither is available, say the list may include shared mailboxes instead of guessing.
>
> **Ve zkratce.** Seznam „zablokovaných účtů s daty“ postavený na `GET /users?$filter=accountEnabled eq false` obsahuje i **sdílené schránky** (`support@`, `info@`, `noreply@`), kterým správce zablokoval přihlášení – a Microsoft doporučuje to udělat u každé sdílené schránky. Mají `userType: Member`, UPN a vypadají přesně jako kolega, který odešel; samotný objekt uživatele vlastnost „tohle je sdílená schránka“ nemá. Odlišíte je sestavou schránek (`getMailboxUsageDetail`, `recipientType` je `Shared` nebo `User`) – jen když sestavy ukazují skutečná jména – nebo po jednom uživateli přes `mailboxSettings.userPurpose`. Když nejde ani jedno, řekněte, že v seznamu mohou být i sdílené schránky, místo hádání.

## Symptom

An offboarding / "OneDrive of people who left" screen lists `support@contoso.com` and "Helpdesk" as *former colleague – blocked*, next to real leavers. An admin following the list would start "handing over" a mailbox that is in active use.

## Why

- Creating a shared mailbox in Exchange Online creates an **active** Entra user with a system-generated password; Microsoft tells admins to block its sign-in. Once blocked, it is a member with a UPN and `accountEnabled: false` — nothing on `/users` distinguishes it from a person who left.
- The authoritative values live in Exchange (`RecipientTypeDetails = SharedMailbox`, `Get-EXOMailbox`), which a browser app can't call.
- Room and equipment mailboxes are also user objects with no person behind them. The mailbox usage report documents only the recipient types `Shared` and `User`, so don't promise to exclude rooms on the strength of that report.

## Fix A — mailbox usage report (one call, whole tenant)

```http
GET https://graph.microsoft.com/beta/reports/getMailboxUsageDetail(period='D7')?$format=application/json
```

Needs `Reports.Read.All` (delegated calls also need the signed-in user to hold a reports-reader admin role). Build a set of UPNs whose `recipientType` is not `User` and drop those from the disabled-accounts list.

```js
const nonPersonal = new Set(
  rows.filter(r => (r.recipientType || '').toLowerCase() !== 'user')
      .map(r => (r.userPrincipalName || '').toLowerCase()));
const leavers = disabledMembers.filter(u => !nonPersonal.has(u.userPrincipalName.toLowerCase()));
```

Treat the report as optional: if it fails (403, throttling) keep all disabled accounts and tell the reader the list may include shared mailboxes.

## Fix B — `mailboxSettings.userPurpose` (per user)

```http
GET https://graph.microsoft.com/v1.0/users/{id}/mailboxSettings/userPurpose
```

Values `user`, `linked`, `shared`, `room`, `equipment`, `others` — so this one also tells rooms and equipment apart. It needs `MailboxSettings.Read` and one call per account, so it suits an app-only job over the (usually short) list of disabled accounts rather than a tenant-wide sweep.

## Concealed names break Fix A

By default Microsoft 365 conceals user details in usage reports — `userPrincipalName` comes back as a hash, so the report can no longer be matched to `/users`. Detect it (no UPN contains `@`) and don't filter on the report; show a note that blocked accounts may include shared mailboxes and where real names are turned on: Microsoft 365 admin center → Settings → Org settings → Services → Reports → clear *Conceal user, group, and site names in all reports* (Global Administrator), or the `adminReportSettings` API.

## Sources

- [Shared mailboxes in Exchange Online](https://learn.microsoft.com/exchange/collaboration-exo/shared-mailboxes) — creation makes an active account; block sign-in
- [Exchange Mailbox usage report](https://learn.microsoft.com/microsoft-365/admin/activity-reports/mailbox-usage) — Recipient type: Shared or User
- [mailboxSettings resource type](https://learn.microsoft.com/graph/api/resources/mailboxsettings) — `userPurpose`
- [Show user details in usage reports](https://learn.microsoft.com/microsoft-365/admin/activity-reports/activity-reports#show-user-group-or-site-details-in-usage-reports)

## Related

- [ApplicationAccessPolicy rejects a shared mailbox](application-access-policy-rejects-shared-mailbox.md) — the same blocked account is why it "isn't a security principal".
- [Usage reports in the browser — use beta JSON](usage-reports-cors-blocked-in-browser.md) — why Fix A uses beta `?$format=application/json`.
