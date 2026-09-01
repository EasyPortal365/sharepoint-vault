---
title: "\"0 sent\" hides whether anyone was even asked — boolean mail wrappers conflate refusal with an empty audience"
tags: [graph, mail-send, sharepoint, groups, permissions, error-handling, notifications]
applies-to: Microsoft Graph (/me/sendMail, /users/{id}/sendMail), SharePoint REST (sitegroups/.../users), any notification path
last-reviewed: 2026-09-01
---

# "0 sent" hides whether anyone was even asked

> **Bottom line.** A notification helper that returns `boolean` (or a bare count) collapses two different worlds into one number: *nobody needed the message* and *the message could not be sent*. The SharePoint side does the same — `sitegroups/…/users` returns an empty array both for an empty group and for a read your account is not allowed to perform. Put the two together and a request waiting for approval silently notifies **nobody**, while the UI reports success. Make the return type carry the failure: `sent | nobody | failed`, and never let a read error become an empty recipient list.
>
> **Ve zkratce.** Notifikační pomocník vracející `boolean` (nebo jen počet) slévá dva různé světy do jednoho čísla: *nebylo komu psát* a *zprávu se nepodařilo odeslat*. SharePoint dělá totéž — `sitegroups/…/users` vrátí prázdné pole jak u prázdné skupiny, tak u čtení, na které účet nemá právo. Dohromady to znamená, že žádost čekající na schválení neupozorní **nikoho**, a UI hlásí úspěch. Chybu musí nést typ návratu: `sent | nobody | failed` – a chyba čtení se nikdy nesmí stát prázdným seznamem příjemců.

## Symptom

An approval queue that nobody works. Requests sit in "waiting" for days; the approver says they never heard about them. Everything looks healthy:

- the request row exists and is correctly stamped;
- the submitter got a confirmation screen with no error;
- there is nothing in the console, nothing in the logs;
- re-running the same flow by hand, as an admin, sends the mail just fine.

## Why it happens

Two independent conflations meet in the middle.

**1. The recipient read.** Group membership is fetched with something like:

```ts
const r = await sp.get(`${web}/_api/web/sitegroups/getbyname('Approvers')/users`);
const users = r.ok ? (await r.json()).value : [];      // ← the bug
```

`[]` now means *either* "the group is empty" *or* "this caller may not read the membership". The second case is ordinary, not exotic: SharePoint groups have an
`OnlyAllowMembersViewMembership` flag, and when it is on, a non-member gets a 403 — which is exactly the account submitting the request.

**2. The send.** The mail helper returns `boolean`:

```ts
async send(to: string[], subject: string, html: string): Promise<boolean> {
  if (!to.length) return false;                        // nobody to send to
  const r = await graph.post('/me/sendMail', …);
  return r.ok;                                          // refused → also false
}
```

`false` now means *either* "no recipients" *or* "Graph refused". The caller sees `false`, has nothing to distinguish, and — because "nobody to notify" is a legitimate outcome — usually treats it as success.

Neither half is wrong on its own. Together they produce a path where a read failure becomes an empty audience, an empty audience becomes a benign `false`, and a benign `false` becomes a green screen.

## What to do instead

**Make the return type carry the distinction.** A three-state outcome costs nothing and cannot be ignored by accident:

```ts
export interface INotifyResult {
  outcome: 'sent' | 'nobody' | 'failed';
  mailed: number;
  failed: number;
  recipientsUnknown: boolean;   // the read itself failed
}
```

**Read strictly.** The membership call must return the read status, not just data:

```ts
async getMembersStrict(group: string): Promise<{ ok: boolean; users: IUser[] }> {
  const r = await sp.get(`${web}/_api/web/sitegroups/getbyname('${esc(group)}')/users`);
  if (!r.ok) return { ok: false, users: [] };      // caller MUST branch on ok
  return { ok: true, users: (await r.json()).value };
}
```

**Put the guarantee in a pure function above the transport.** Once a layer guarantees a non-empty recipient list, the transport's `false` can only mean "refused" — the ambiguity disappears by construction rather than by discipline. That function takes its dependencies as parameters, so it is testable without SharePoint, Graph, or a UI framework.

**Say it in the UI.** The three outcomes need three different sentences, and "we could not read who the approvers are" must tell the user to notify their manager themselves. A value nobody renders is still silence.

## How to verify

The test that matters is **B vs C**: *"membership could not be read"* and *"there is genuinely nobody to notify"* must produce **different** results — in the returned value *and* in the rendered text.

Then falsify it: delete the `if (!read.ok)` branch (the pre-fix state) and re-run. The B case must collapse into `nobody`, and the test must fail:

```
● B1: membership unreadable → failed + recipientsUnknown
    Expected: "failed"   Received: "nobody"
● B and C must differ (previously indistinguishable)
    Expected: not "nobody"
```

If the suite still passes with that branch removed, the test is measuring the wrong thing.

## Related traps in the same family

- **The transport-side half of this trap:** [A `mailto:` fallback reported as sent](sendmail-fallback-reported-as-sent.md) — `sendMail` fails outright on accounts without a mailbox, and a `mailto:` fallback only hands off a draft. Same conclusion from the other end: three states, never a boolean.

- **A screen that closes on success must not close when a follow-up step failed** — it is the only carrier of that message. Keep it open and reduce the footer to a single "Close" so the action cannot be repeated.
- **A reload handler that clears the error state will silently overwrite a message written just before it.** The order of `setError` and `await load()` is a functional difference; no compiler or linter sees it.
- **"Row not found" during cleanup has two meanings**, decided by the caller's expectation: deleting nothing is fine only when nothing was supposed to be there. Pass the expectation in, and verify after the delete with a cache-busted read.
