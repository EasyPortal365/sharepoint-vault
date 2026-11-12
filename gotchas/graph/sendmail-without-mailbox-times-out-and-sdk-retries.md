---
title: "`/me/sendMail` from an account without a mailbox can time out with 504 – and the Graph SDK retries it three more times"
short-title: sendMail without a mailbox – 504 and four attempts
summary: "No `MailboxNotEnabled` error, just a 504 after ~30 s; the SDK RetryHandler repeats the non-idempotent POST up to 3×, so the button hangs ~2 min and a late success can send duplicates; check `assignedPlans` for an enabled `exchange` plan first"
tags: [graph, mail-send, sendmail, retry, msgraphclient, spfx, mailbox, admin-accounts]
applies-to: Microsoft Graph v1.0 (delegated Mail.Send), SPFx MSGraphClientV3, @microsoft/microsoft-graph-client RetryHandler
last-reviewed: 2026-11-12
---

# `/me/sendMail` from an account without a mailbox: 504, then three retries

> **Bottom line.** For a signed-in account that has no Exchange Online mailbox (typical for cloud-only admin accounts), `POST /me/sendMail` doesn't always fail fast with `MailboxNotEnabledForRESTAPI` – it can hang about 30 seconds and return **504 UnknownError**. The Graph JS client's default `RetryHandler` retries 504 (and 429/503) **up to three times, POST included**, so one click becomes four requests and roughly two minutes of a spinning button. Because `sendMail` is not idempotent, a request that actually went through server-side but timed out on the way back can be sent again. The account's `mail` property and the SharePoint site user's e-mail can be filled in for such accounts, so they are no signal. Read `/me?$select=assignedPlans` once and send only when there is a plan with `service: "exchange"` and `capabilityStatus` `Enabled` (or `Warning`); otherwise skip the call and show the same message you show for "mailbox not enabled".
>
> **Ve zkratce.** U přihlášeného účtu bez schránky Exchange Online (typicky cloudový správcovský účet) `POST /me/sendMail` nemusí hned skončit chybou `MailboxNotEnabledForRESTAPI` – umí ~30 s viset a vrátit **504 UnknownError**. Výchozí `RetryHandler` klienta Graphu opakuje 504 (i 429/503) **až třikrát, i u POST**, takže z jednoho kliknutí jsou čtyři požadavky a zhruba dvě minuty točícího se tlačítka. `sendMail` není idempotentní – požadavek, který na serveru prošel a jen mu vypršela odpověď, se může odeslat znovu. Vlastnost `mail` účtu ani e-mail uživatele webu v SharePointu signálem nejsou, umí být vyplněné. Jednou přečtěte `/me?$select=assignedPlans` a posílejte, jen když je tam plán `service: "exchange"` s `capabilityStatus` `Enabled` (nebo `Warning`); jinak volání vynechte a ukažte stejnou hlášku jako u „schránka není aktivní“.

## Symptom

A "Send reminder" button in an SPFx web part, clicked by a global admin account:

- the button shows its busy state for about two minutes,
- the network shows **four** `POST https://graph.microsoft.com/v1.0/me/sendMail` requests (if you can see them at all – `MSGraphClient` calls are easy to miss in DevTools), each ending in `504` after ~30 s,
- the app finally reports a raw `HTTP 504 · UnknownError` instead of anything about a mailbox.

The same account elsewhere gets the well-known `MailboxNotEnabledForRESTAPI` / "The mailbox is either inactive, soft-deleted, or is hosted on-premise" – so code that only matches that error never fires.

## Why

1. **The account has no Exchange Online plan.** Admin accounts are often licensed without Exchange, or not licensed at all. Graph may reject `sendMail` immediately or may wait on the mailbox lookup until the gateway gives up with 504.
2. **The SDK retries it.** `@microsoft/microsoft-graph-client` (which `MSGraphClientV3` wraps) installs a `RetryHandler` by default: up to 3 retries for 429, 503 and 504, with exponential back-off, and it retries requests with a buffered body – a JSON `sendMail` body is buffered. So a timeout becomes 4 × 30 s.
3. **The usual signals lie.** The `mail` property on `/me` and the site user's `Email` in SharePoint (`/_api/web/currentuser`) can both be filled in for such an account – they come from the directory, not from a mailbox. (`pageContext.user.email`, on the other hand, is often *empty* for these accounts – a different trap, see below – so neither filled nor empty tells you whether mail will go.)

## Fix

Ask once per session whether the sender can send at all, before the first `sendMail`:

```ts
interface IAssignedPlan { service?: string; capabilityStatus?: string; }

/** true = has a usable Exchange plan, false = certainly not, undefined = could not tell. */
export function hasExchangePlan(plans: IAssignedPlan[] | undefined): boolean | undefined {
  if (!Array.isArray(plans)) return undefined;
  return plans.some(p => !!p && String(p.service || '').toLowerCase() === 'exchange'
    && (p.capabilityStatus === 'Enabled' || p.capabilityStatus === 'Warning'));
}

let mailboxCheck: Promise<boolean | undefined> | undefined;
function senderHasMailbox(client: MSGraphClientV3): Promise<boolean | undefined> {
  if (!mailboxCheck) {
    mailboxCheck = client.api('/me?$select=assignedPlans').get()
      .then((me: { assignedPlans?: IAssignedPlan[] }) => hasExchangePlan(me.assignedPlans))
      .catch(() => undefined);   // unreadable = don't block sending on a guess
  }
  return mailboxCheck;
}

// before sending:
if (await senderHasMailbox(client) === false) {
  // same message as for MailboxNotEnabledForRESTAPI – do not call sendMail at all
}
```

- `assignedPlans` comes back only when you ask for it with `$select`. It is a property of the signed-in user's own profile (measured with an app that also had `User.Read.All` consented).
- `Warning` means the subscription is in a grace period – mail still works, so keep sending.
- If the plans can't be read, **send anyway**: refusing on a failed read would block users who do have a mailbox.

## Also worth doing

- Treat the `RetryHandler` as part of your write path: when you debug a "slow send", count requests in the network log, not clicks.
- If duplicates would hurt (notifications to external people), consider sending through a client without the retry middleware for this one call, or make the message idempotent on your side (record "sent" before showing success, check it before resending).

## See also

- [A mail-permission probe that can't tell "no mailbox" from "no consent"](mail-probe-no-mailbox-vs-no-consent.md)
- [A `mailto:` fallback reported as sent](sendmail-fallback-reported-as-sent.md)
- [`MSGraphClient` calls bypass the DevTools network panel](msgraphclient-calls-bypass-devtools-network.md)
- [Per-user data vanishes for admin accounts](../spfx/user-email-is-empty-for-mailbox-less-accounts.md)
