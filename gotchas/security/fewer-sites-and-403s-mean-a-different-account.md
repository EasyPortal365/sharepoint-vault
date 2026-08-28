---
title: Fewer sites and sudden 403s usually mean a different account, not a tenant outage
tags: [security, permissions, search, troubleshooting, browser]
applies-to: SharePoint Online (browser-driven admin scripts and console snippets)
last-reviewed: 2026-08-28
---

# Fewer sites and sudden 403s usually mean a different account, not a tenant outage

> **Bottom line.** Before you conclude that an account "lost access", ask **who is asking**: `GET /_api/web/currentuser` → `LoginName`. A tenant-wide script run from a second browser window can silently execute as a different signed-in account, and its 403s and shrunken Search results look exactly like a permissions incident.
>
> **Ve zkratce.** Než usoudíš, že účet „ztratil přístup", zjisti, **kdo se ptá**: `GET /_api/web/currentuser` → `LoginName`. Skript nad celým tenantem spuštěný z jiného okna prohlížeče může běžet pod jiným přihlášeným účtem a jeho 403 i zmenšený výsledek Search vypadají přesně jako incident s oprávněními.

## What it looks like

A console snippet that enumerates sites via Search and reads a config list on each one:

- yesterday: 30 sites, no errors;
- today: 16 sites, and two specific site collections return `403` (the page itself redirects to `AccessDenied.aspx`);
- nothing was deployed or re-permissioned in between.

The natural reading is "the account lost access to half the tenant, probably group-membership propagation or a service incident". That reading sends you to sign-in logs and group membership — and finds nothing, because nothing happened.

## What is actually going on

Admins routinely keep **several browser windows signed in as different accounts** — a day-to-day work account and a privileged/global-admin one. The two see different numbers of sites *by design*.

Two ways to end up in the wrong one without noticing:

1. **A new tab lands in the last-focused window.** Any automation that opens a fresh tab (rather than reusing the one you were working in) inherits *that* window's session.
2. **Multiple accounts in one browser profile.** A brand-new tab can default to the primary account while previously opened tabs keep the account they were opened with.

## The check

```js
// who is this session, really?
const u = await (await fetch('/_api/web/currentuser',
  { headers: { accept: 'application/json;odata=nometadata' } })).json();
console.log(u.LoginName);   // i:0#.f|membership|someone@contoso.com
```

Print it **at the top of every tenant-wide snippet**, next to the result count. Two lines of output turn an hour of false diagnosis into an instant answer.

## Result count is a cheap detector

Search over sites returns only what the caller can see:

```js
// contentclass:STS_Site OR STS_Web, rowlimit high enough for your tenant
console.log('sites visible to this account:', rows.length);
```

If that number drops between two runs and nothing was deployed, **"different account" is the first hypothesis, not "index outage"**. Bake a floor into the script (`if (rows.length < EXPECTED) console.warn(...)`) so an incomplete sweep announces itself instead of looking finished.

## Related

- `security/effective-permissions-bitmask-off-by-one.md` — when you do need to reason about real permissions.
- `graph/mail-probe-no-mailbox-vs-no-consent.md` — same family: distinguishing "not allowed" from "not applicable".
