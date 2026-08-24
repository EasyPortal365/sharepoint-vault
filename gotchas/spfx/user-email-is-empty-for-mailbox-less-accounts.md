---
title: "Per-user data vanishes for admin accounts: pageContext.user.email is empty and `eq ''` matches nothing"
tags: [spfx, page-context, identity, rest-api, odata, filter, admin-accounts, lists]
applies-to: SharePoint Online (SPFx web parts and extensions storing per-user rows in a list)
last-reviewed: 2026-08-24
---

# Per-user data vanishes for admin accounts: `pageContext.user.email` is empty and `eq ''` matches nothing

> **Bottom line.** Accounts without a mailbox — typically the `adm.*` / service accounts you deploy and test with — get an **empty string** from `context.pageContext.user.email`. If that value is your identity key, every row you write lands with an empty field, SharePoint stores empty text as **NULL**, and your `$filter=Field eq ''` then matches **nothing**. The data is saved and unreadable at the same time. Key per-user data on `email || UPN`, never on the raw email.
>
> **Ve zkratce.** Účty bez poštovní schránky – typicky `adm.*` a servisní účty, kterými nasazujete a testujete – dostanou z `context.pageContext.user.email` **prázdný řetězec**. Když je to váš klíč identity, uloží se každý řádek s prázdným polem, SharePoint prázdný text ukládá jako **NULL** a filtr `$filter=Field eq ''` pak nenajde **nic**. Data jsou uložená a zároveň nečitelná. Osobní data klíčujte na `email || UPN`, nikdy na holý e-mail.

## Symptom

A tester reports it on one account and not another, which is what makes this expensive to diagnose:

- On their **regular** account the feature works.
- On their **admin** account, their own records "keep disappearing". They create something, it works for the rest of the session, and after a reload or after closing the panel it is gone.
- Nothing is logged. No 4xx, no 5xx. The write returned `201 Created`.

Looking in the list through the browser confirms the worst version of the confusion: **the rows are there.** So the app looks like it is deleting user data.

## Cause

Two independent behaviours line up.

**1. `pageContext.user.email` is empty for accounts with no mailbox.** It is not a bug and not a permissions problem — the property is sourced from the user's mail attribute, and admin/service accounts routinely have none. `loginName` and `displayName` are still populated. A common shape of the defect is a "safe-looking" fallback:

```ts
this._userId = context.pageContext.user.email || '';   // <- empty string for adm.* accounts
```

**2. In SharePoint, empty text is NULL, and `eq ''` does not match NULL.** Writing `{ MyUserField: '' }` to a single line of text column stores NULL. Reading it back with

```
/_api/web/lists/getbytitle('MyList')/items?$filter=MyUserField eq ''
```

returns `200 OK` with an **empty** `value` array. Not an error — just nothing. Every "load my stuff" call quietly returns zero rows, and the UI has no way to tell that apart from "the user has nothing yet".

The combination means the account can write rows it can never read again.

### Why the "healthy" account misleads you further

Because the admin account loads zero personal rows, it never restores whatever those rows would have triggered. Any expensive or buggy code path that only runs *when personal data exists* also never runs there. So the broken account can look **healthier** than the working one, and you will spend your time comparing permissions instead of comparing identity.

## Fix

Key the identity on the UPN when the mailbox is missing. The UPN is present on every account and is stable and unique:

```ts
// SPFx gives a claim: i:0#.f|membership|user@domain -> the UPN is the last segment
const login = context.pageContext.user.loginName || '';
const upn = login.indexOf('|') !== -1 ? login.substring(login.lastIndexOf('|') + 1) : login;
const email = context.pageContext.user.email;
const mailbox = (typeof email === 'string' && email.indexOf('@') !== -1) ? email : '';

if (!mailbox) {
  // Not an error — a different kind of account. But it MUST be visible, because it
  // changes the key that all personal data is stored under.
  console.warn('[app] account without a mailbox — personal data identity falls back to UPN:', upn);
}
this._identity = mailbox || upn || '';
```

Notes that make this safe to retrofit:

- **It is backward compatible.** For any account that *has* a mailbox, `email || upn` is still `email`, so existing stored rows keep matching. Only accounts for which nothing worked at all change behaviour.
- **Do not fall back to `displayName`.** It is neither unique nor stable; it is fine as a label in a report, never as a key.
- **Fix every occurrence in one pass.** This kind of identity is usually copied into several places (settings, history, preferences, per-user counters). Half a fix is worse than none, because the remaining half now looks deliberate.
- **If you genuinely want to query for blank values**, ask for `$filter=Field eq null`. `eq ''` is not a query for "empty".
- **Make an empty identity loud.** A read that returns zero rows because the key was empty should not look like "no data yet". Log it, or surface it in a diagnostic view.

## Test for it

Add an account with no mailbox to your test matrix. It is not an exotic case: the person who installs the solution is usually an admin, so a mailbox-less account is frequently the **first** account that ever opens your app — and the first to hit this.

A one-line check from the browser console on a page where your solution runs:

```js
// empty string here = your identity key is about to be empty too
_spPageContextInfo.userEmail
```
