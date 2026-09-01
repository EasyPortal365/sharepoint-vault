---
title: A mailto: fallback that reuses the success state tells the user their message was sent when it wasn't
tags: [graph, mail, spfx, error-handling, ux]
applies-to: Microsoft Graph (/me/sendMail, delegated), SPFx web parts
last-reviewed: 2026-08-29
---

# A mailto: fallback that reuses the success state tells the user their message was sent when it wasn't

> **Bottom line.** `POST /me/sendMail` fails on any account without an Exchange Online mailbox — admin and cloud-only accounts, exactly the ones you test with. A `mailto:` fallback is a fine recovery, but it only *hands the draft to a mail client*; it does not deliver anything. If the catch branch sets the same "sent" flag as the success branch, the user reads a green *"We've received your report"* while the message sits unsent in a window they may never look at. Model the outcome as three states — sent / handed off / failed — not as a boolean, and give the handoff its own wording and colour.
>
> **Ve zkratce.** `POST /me/sendMail` selže na každém účtu bez schránky Exchange Online – tedy na admin a cloud-only účtech, přesně těch, na kterých testujete. Fallback na `mailto:` je legitimní záchrana, ale jen *předá koncept poštovnímu klientovi*; nic nedoručí. Když větev catch nastaví tentýž příznak „odesláno" jako větev úspěchu, uživatel čte zelené *„Váš podnět jsme přijali"*, zatímco zpráva leží neodeslaná v okně, do kterého se nemusí podívat. Výsledek modelujte třemi stavy – odesláno / předáno / selhalo – ne booleanem, a předání dejte vlastní text i barvu.

## Symptom

A feedback form sends through Graph and falls back to `mailto:` when that throws:

```ts
try {
  await graph.api('/me/sendMail').post(message);
  setDone(true);
} catch (e) {
  window.location.href = 'mailto:support@example.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  setDone(true);          // <-- the lie
}
```

On a normal user account everything works and the branch never runs. On an admin account the POST fails:

```json
{ "error": { "code": "MailboxNotEnabledForRESTAPI",
             "message": "The mailbox is either inactive, soft-deleted, or is hosted on-premise." } }
```

…the mail client opens (or silently doesn't, if none is registered), and the form still shows the green confirmation. Nobody notices, because the branch that lies is the branch nobody tests.

## Cause

Two independent things get collapsed into one boolean:

1. **The message reached the server** — Graph returned 202, delivery is the tenant's problem now.
2. **The message reached a mail client** — `mailto:` navigation was issued. Whether a client is registered, whether it opened, and whether the user then pressed Send are all unknowable to the page.

A `boolean` has room for only one of them, so the fallback borrows the success state. It is the same defect class as `fetch(url, { mode: 'no-cors' })`: the response is opaque, the promise resolves, and the app reports success it never observed.

Attachments make it worse — `mailto:` cannot carry them at all, so the handoff silently drops files the user attached.

## Fix

Three states, and a distinct card for the middle one:

```ts
const [done, setDone] = React.useState<'' | 'sent' | 'handoff'>('');

try {
  await graph.api('/me/sendMail').post(message);
  setDone('sent');                               // green: delivered
} catch (e) {
  const opened = openMailClient(subject, body);  // mailto: navigation
  if (!opened) { setError(describe(e)); return; }
  setDone('handoff');                            // amber: NOT delivered yet
}
```

```tsx
{done === 'sent' && <Card tone="ok">Thanks — we've got your report.</Card>}
{done === 'handoff' && (
  <Card tone="warn">
    We couldn't send this from the app, so we opened your mail client with the text prepared.
    <strong> Your report isn't sent until you press Send there.</strong>
    {hadAttachments && ' Attachments couldn't be carried over — please attach them again.'}
  </Card>
)}
```

Wording carries the whole weight here: "We've received your report" and "Press Send in your mail client" are different promises, and only one of them is true after a fallback.

## Notes

- **The same trap has a recipient-side half:** if the *audience* is read in a way that turns a denied read into an empty array, "nobody to notify" and "we were not allowed to look" become the same `0 sent`. See ["0 sent" hides whether anyone was asked](zero-sent-hides-whether-anyone-was-asked.md).

- **Test on an account that reproduces the branch.** A tenant admin without a mailbox is the cheapest way to force the catch path on demand; a licensed user account will never show you this bug. The reverse also holds — proving delivery requires an account that *has* a mailbox, so verify both branches on different accounts.
- Distinguishing "no mailbox" from "no consent" is a separate trap with its own three outcomes: see [mail-probe-no-mailbox-vs-no-consent.md](mail-probe-no-mailbox-vs-no-consent.md).
- `sendMail` always sends **as the signed-in user** in the delegated flow, which is usually what you want for feedback — see [sendmail-from-is-the-signed-in-user.md](sendmail-from-is-the-signed-in-user.md).
- Attachment limits apply to the whole message, not per file: [sendmail-attachment-size-ceiling.md](sendmail-attachment-size-ceiling.md).
- The general rule beyond mail: **a recovery path may report only what it actually observed.** If the observation is "I handed this to something outside the page", say exactly that.
