---
title: A newsletter looped over /me/sendMail is not bulk e-mail — and ACS Email is no longer the way out
short-title: A newsletter looped over `/me/sendMail` is not bulk e-mail
summary: Per-mailbox and tenant limits, bulk mail through Microsoft 365 "isn't a supported use", JSON `sendMail` can't set `List-Unsubscribe`, ACS Email retires 2028; keep Graph for personal batches, send newsletters through an ESP via a server-side connector
tags: [graph, mail, sendmail, exchange-online, bulk-email, deliverability, spfx]
applies-to: Microsoft Graph (/me/sendMail, delegated Mail.Send), Exchange Online, SPFx / browser clients
last-reviewed: 2026-09-24
---

# A newsletter looped over /me/sendMail is not bulk e-mail — and ACS Email is no longer the way out

> **Bottom line.** A campaign sent as a loop of `POST /me/sendMail` from the signed-in user's mailbox passes every test and is unsupported at scale: 30 messages a minute and 10,000 recipients a day per mailbox, a tenant-wide cap on external recipients, and Microsoft says sending bulk e-mail through Microsoft 365 "isn't a supported use of the service" (it runs "best-effort") and may block the sender — which also stops their everyday mail. The JSON `sendMail` payload only accepts `x-` headers, so you cannot add the `List-Unsubscribe` header that Gmail and Yahoo require from bulk senders (Gmail in its RFC 8058 one-click form; Yahoo "highly recommends" that form). And the Microsoft service the docs point to for bulk mail, Azure Communication Services Email, is being retired. Keep Graph for small, personal batches — paced, with an opt-out sentence, every failure recorded — and send newsletters through a dedicated e-mail service behind a server-side connector.
>
> **Ve zkratce.** Kampaň jako smyčka `POST /me/sendMail` ze schránky přihlášeného uživatele projde každým testem, ve větším měřítku ji ale Microsoft nepodporuje: 30 zpráv za minutu a 10 000 příjemců denně na schránku, strop externích příjemců za celý tenant a o hromadné poště přes Microsoft 365 Microsoft říká, že „isn't a supported use of the service“ (běží jen „best-effort“) – odesílatele může zablokovat, a tím mu zastaví i běžnou poštu. JSON verze `sendMail` přijme jen hlavičky `x-`, takže hlavičku `List-Unsubscribe`, kterou Gmail a Yahoo po hromadných odesílatelích chtějí (Gmail v podobě jedním klikem podle RFC 8058, Yahoo ji v této podobě „highly recommends“), nenastavíte. A služba, na kterou Microsoft pro hromadnou poštu odkazuje – Azure Communication Services Email – končí. Graph nechte na malé osobní dávky (s brzdou, odhlašovací větou a zápisem každého neúspěchu), newslettery posílejte přes specializovanou službu napojenou serverovým konektorem.

## Symptom

A browser app (a CRM, an intranet news page) gets a "send campaign" button:

```js
for (const c of contacts) {                        // hundreds or thousands
  await client.api('/me/sendMail').post({
    message: { subject, body: { contentType: 'HTML', content: render(c) },
               toRecipients: [{ emailAddress: { address: c.email } }] },
    saveToSentItems: true
  });
}
```

Twenty test contacts go out fine. At real volume the platform starts saying no in ways the loop doesn't see:

- `429` throttling, or a `202` for a message that never arrives — `202` means *accepted*, not delivered.
- The tenant-wide external limit answers with NDR `550 5.7.233`.
- Exchange Online Protection may restrict the sending user — their normal business mail stops too.
- Recipients who can't unsubscribe report spam instead; more spam reports push later mail into junk, and a bulk sender without one-click unsubscribe gets no delivery support from Gmail.

## Cause

Four facts that are each documented separately and only hurt together:

1. **Per-mailbox limits:** 10,000 recipients per 24 hours and 30 messages per minute ([Exchange Online limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits)).
2. **Per-tenant limit (TERRL):** 500 × (non-trial e-mail licences^0.7) + 9,500 external recipients per rolling 24 hours — 14,259 for 25 licences; distribution-group members count one by one, and new tenants start with a fraction of it ([announcement](https://techcommunity.microsoft.com/blog/exchange/introducing-exchange-online-tenant-outbound-email-limits/4372797)). The per-mailbox 2,000-external-recipient limit (ERR) was cancelled in January 2026, but the same post keeps the goal of stopping "line-of-business (LOB) applications sending bulk email through Exchange Online" ([cancellation](https://techcommunity.microsoft.com/blog/exchange/exchange-online-canceling-the-mailbox-external-recipient-rate-limit/4483498)).
3. **Bulk e-mail isn't a supported use.** Microsoft tells Exchange Online customers who send newsletters to use "third-party providers that specialize in these services" ([Exchange Online limits](https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits)); sending bulk e-mail through Microsoft 365 "isn't a supported use of the service", runs "best-effort", and a user who sends too much gets blocked ([outbound spam protection](https://learn.microsoft.com/en-us/defender-office-365/outbound-spam-protection-about)).
4. **No unsubscribe headers.** In a Graph message you may only add custom headers whose names start with `x-` ([message resource](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)), so `List-Unsubscribe` / `List-Unsubscribe-Post` are out of reach. The MIME form of `sendMail` has no documented `x-` rule, but nothing says Exchange Online keeps a `List-Unsubscribe` header either — test before relying on it; the volume limits apply regardless. Gmail requires one-click unsubscribe for marketing mail from senders of 5,000+ messages a day to Gmail accounts ([Gmail sender guidelines](https://support.google.com/a/answer/81126)); Yahoo requires a working `List-Unsubscribe` header ([Yahoo](https://senders.yahooinc.com/best-practices/)). A missing one-click header alone isn't rejected — the sender loses Gmail's delivery support — but since November 2025 Gmail has been ramping up enforcement, including temporary and permanent rejections of mail that fails its requirements ([Gmail FAQ](https://support.google.com/a/answer/14229414)). Yahoo requires unsubscribes to be honoured within 2 days; Gmail recommends 48 hours.

The obvious Microsoft escape hatch is closing: **Azure Communication Services Email is retiring on 30 September 2028, new customers can't sign up for the retiring ACS services from 23 October 2026, and Microsoft recommends migrating existing workloads off it "rather than onboarding new solutions"**. The replacements it names are High Volume Email (internal recipients only), Exchange Online, and Marketplace partners ([ACS retirement guide](https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide)).

## Fix

Decide which of two features you are building — they are not the same feature with a bigger number.

**Personal batches (tens to low hundreds of recipients)** — invitations, follow-ups after an event. Graph is fine if the loop behaves:

```js
const GAP_MS = 2100;                                 // stay under 30 messages / minute per mailbox

async function sendPersonalBatch(client, recipients, build, record) {
  for (const r of recipients) {
    for (let attempt = 0; ; attempt++) {
      try {
        await client.api('/me/sendMail').post({ message: build(r), saveToSentItems: true });
        await record(r, 'accepted');                 // accepted by Exchange, not "delivered"
        break;
      } catch (e) {
        const status = e.statusCode ?? e.status;
        if (status === 429 && attempt < 3) {
          // Graph exposes Retry-After to the browser; keep a fixed fallback in case it's missing
          const wait = Number(e.headers?.get?.('Retry-After')) || 30;
          await new Promise(res => setTimeout(res, wait * 1000));
          continue;
        }
        await record(r, 'failed', status);           // resend to these, never to everyone again
        break;
      }
    }
    await new Promise(res => setTimeout(res, GAP_MS));
  }
}
```

- Put an opt-out sentence into **both** the HTML and the plain-text body ("Reply to this message and we'll stop writing to you."), and honour it. In the EU, every direct-marketing e-mail must give a valid address for opt-out requests (ePrivacy Directive 2002/58/EC, Art. 13(4)), e-mail marketing needs prior consent except to your own customers about similar products (Art. 13(1)–(2)), and consent you rely on must be provable (GDPR Art. 7(1)). US CAN-SPAM requires no prior consent but a clear opt-out in every commercial e-mail, honoured within 10 business days ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)).
- Record every outcome per recipient. "12 of 300 failed" with no names forces the user to resend to all 300.
- Cap the audience and say why in the UI; that is the product boundary, not a bug.

**Newsletters and marketing automation** — use a dedicated e-mail service (an ESP) and keep its API key on a server. None of the common ESP APIs is safe to call from the browser (measured from a SharePoint origin, 2026-09-24):

| Service | Browser call from a SharePoint origin |
|---|---|
| Mailchimp | preflight `400`, no `Access-Control-*` headers — and Mailchimp's docs rule out client-side use |
| SmartEmailing | preflight `405`, no `Access-Control-Allow-Origin` |
| Ecomail | the preflight answers, but its API-key header (`key`) is not among the allowed headers |
| Brevo, MailerLite | the preflight passes (Brevo echoes the calling origin, MailerLite answers `*`) — it would work, but every user's browser would hold the account's API key (Brevo: keys "give full access to your Brevo account"; MailerLite tokens can't be scoped) |

So the design is a small server-side connector (a Function App or similar) that holds the ESP credentials, syncs contacts that have consent, and pulls back unsubscribes and engagement. The ESP owns deliverability, bounces, complaints and the unsubscribe endpoint.

## Notes

- **Open tracking is unreliable anyway.** Apple Mail Privacy Protection downloads remote content in the background whether or not the message is opened ([Apple](https://www.apple.com/legal/privacy/data/en/mail-privacy-protection/)). Clicks are the better signal, though not untouched: since iOS 17, Link Tracking Protection strips known tracking parameters from links in Mail ([Apple Newsroom](https://www.apple.com/newsroom/2023/06/apple-announces-powerful-new-privacy-and-security-features/)). If you build your own sending, measure clicks, not opens.
- **High Volume Email is not a workaround** — it is for internal recipients only ([HVE](https://learn.microsoft.com/en-us/exchange/mail-flow-best-practices/high-volume-mails-m365)).
- **Every ESP counts differently.** Some bill unsubscribed and non-subscribed contacts too (Mailchimp does), which is one more reason to sync only contacts with consent instead of the whole CRM.
- Related: [`/me/sendMail`: From is always the signed-in user](sendmail-from-is-the-signed-in-user.md) · ["0 sent" hides whether anyone was asked](zero-sent-hides-whether-anyone-was-asked.md) · [`Retry-After` does not survive CORS](../azure-functions/retry-after-does-not-survive-cors.md) · [`SP.WebProxy` is add-in-only](../spfx/webproxy-is-add-in-only.md)
