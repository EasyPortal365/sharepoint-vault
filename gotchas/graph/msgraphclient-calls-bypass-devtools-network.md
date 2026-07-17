---
title: SPFx MSGraphClient calls don't show in DevTools Network — and how to diagnose them anyway
tags: [graph, spfx, debugging, tooling]
applies-to: SharePoint Framework (SPFx), Microsoft Graph, Chrome DevTools
last-reviewed: 2026-07-17
---

# SPFx `MSGraphClient` calls don't show in DevTools Network — and how to diagnose them anyway

## Symptom

You're debugging an SPFx web part that calls Microsoft Graph through
`MSGraphClientFactory` / `MSGraphClientV3`. You open the browser's **Network** tab (or drive
it through a Chrome-extension / MCP automation) to inspect the request and response — and
there is **nothing**. No `graph.microsoft.com` entry. The `console` is empty too, or clears
the moment the page navigates. You end up guessing why a Graph feature returns no data.

## Cause

`MSGraphClient` issues its requests from inside the SharePoint page framework's own worker /
fetch plumbing, not as a plain page-level `fetch` you can intercept. Automation layers that
read "the page's network requests" (including some Chrome-extension MCP tools) only see
page-context XHR/fetch, so the Graph traffic slips past them. Console logging can help, but a
full-page navigation wipes the captured console buffer, so a warning printed during load is
gone by the time you look.

The trap: you conclude "the call isn't happening" or start changing code blindly, when in
fact the call happened and you simply can't see it through that lens.

## Fix

Don't rely on the Network tab for `MSGraphClient` traffic. Diagnose from what *is*
observable:

1. **Did the call fire, and how many?** `performance.getEntriesByType('resource')` records
   every request including `MSGraphClient`'s. Count and inspect them:
   ```js
   performance.getEntriesByType('resource')
     .map(r => r.name)
     .filter(n => n.indexOf('graph.microsoft.com') !== -1)
     .length
   ```
   A non-zero count proves the load ran (and how many sub-requests it made) even though
   Network showed nothing. ⚠️ Some automation tools **block returning a string that contains
   a Graph URL with a query string** ("cookie/query-string data") — so return `.length` or a
   sanitized path, not the raw URLs.

2. **Which account are you actually on?** Before blaming code, confirm identity —
   `/_api/web/currentuser?$select=LoginName,Title`. An admin-only / unlicensed account (no
   Microsoft 365 mailbox or calendar) makes every user-context Graph call fail with 403
   ("Failed to get license information…", "mailbox is either inactive…"), which looks exactly
   like a bug. This one wastes hours if you don't check it first.

3. **What's actually rendered?** `document.querySelectorAll(...)` on the live DOM tells you
   what the component decided to show (e.g. a tab that's missing because a fail-safe hid it).

4. **Get the real response from the user.** The cleanest source of the actual Graph JSON is
   the person running the app: have them open DevTools → Network in *their* session, run the
   action, and copy the response. It's faster and safer than trying to lift their token —
   reading delegated tokens out of `localStorage`/MSAL cache is (rightly) blocked by most
   automation sandboxes, and you shouldn't work around that.

## Takeaway

"I can't see the request in Network" is not evidence the request didn't happen. For
`MSGraphClient`, prove execution with `performance` entries, confirm the account with
`currentuser`, read the DOM for the outcome, and ask the user for the response body — instead
of guessing or editing blind.
