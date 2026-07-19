---
title: Graph /me/sendMail — From is always the signed-in user
tags: [graph, email, permissions]
applies-to: Microsoft Graph (Microsoft 365)
last-reviewed: 2026-07-15
---

# Graph `/me/sendMail`: From is always the signed-in user

> **Bottom line.** Delegated `/me/sendMail` always sends as the signed-in user — you can't override From, so route any "sender" setting to Reply-To and reach for app-only permissions plus a shared mailbox only if you genuinely need a service address.
>
> **Ve zkratce.** Delegované `/me/sendMail` odesílá vždy jménem přihlášeného uživatele – From nepřepíšeš, takže jakékoli nastavení „odesílatele" směřuj na Reply-To a po app-only oprávněních se sdílenou schránkou sáhni jen tehdy, když opravdu potřebuješ servisní adresu.

## Symptom

Your app sends notification e-mails via `POST /me/sendMail` with delegated `Mail.Send`. The customer asks for them to come from `noreply@contoso.com` — you set `message.from` accordingly, and Graph rejects the call (SendAs denied), or you're tempted to "just make it configurable" and it never works.

## Cause

With **delegated** `Mail.Send`, mail is sent *as the signed-in user* — that's the whole security model. Graph accepts a different `from`/`sender` only when the user genuinely holds **SendAs** rights on that mailbox. There is no header, property, or permission scope that lets a normal delegated call impersonate an arbitrary address.

## Fix

Two honest options:

**A. Embrace the personal From** (usually right for intranet scenarios — a message from a real colleague gets read) and give admins control over what they *can* control:

```ts
message: {
  subject,
  body,
  toRecipients,
  replyTo: [{ emailAddress: { address: configuredReplyTo } }]
}
```

Let any "sender address" setting in your app govern **Reply-To**, footer and branding — never From.

**B. Truly need a service address?** That's a different architecture: **application** permissions (`Mail.Send` as app-only, admin-consented and ideally scoped via an application access policy) sending from a shared mailbox — plus the deliverability homework (SPF/DKIM/DMARC alignment) that comes with it.

## Notes

- If you rename a "Sender" setting to "Reply-To" in the UI, users stop filing bugs about it — the setting finally does what it says.
- App-only `Mail.Send` without an application access policy can send as *anyone* in the tenant — scope it, or security review will (rightly) flag it.
