---
title: "Locking down a no-script site from code: web NoCrawl is denied even to a site collection admin, and turning off access requests returns 200 and changes nothing"
short-title: Lock down a no-script site from code
summary: "On a modern site with custom scripts disabled, `NoCrawl` on the WEB returns 403 via REST and CSOM even for a site collection admin, and `SetUseAccessRequestDefaultAndUpdate(false)` returns 200 without effect; both work through the site settings pages, while `MembersCanShare` and the limited-access lockdown feature are writable via REST. Always re-read after writing a web setting."
tags: [security, permissions, noscript, nocrawl, access-requests, members-can-share, lockdown, rest-api, csom]
applies-to: SharePoint Online (modern sites with custom scripts disabled), delegated calls from SPFx or the browser
last-reviewed: 2026-11-12
---

# Locking down a no-script site from code: web NoCrawl is denied even to a site collection admin, and turning off access requests returns 200 and changes nothing

> **Bottom line.** A "prepare a confidential site" button can do most of the hardening through REST — `MembersCanShare = false` and the limited-access user permission lockdown feature both work. Two settings cannot be done from code on a site with custom scripts disabled: `NoCrawl` on the **web** fails with 403 even for a site collection admin, and `SetUseAccessRequestDefaultAndUpdate(false)` returns 200 but leaves `UseAccessRequestDefault` at `true`. Both work through the site settings pages (`srchvis.aspx`, `setrqacc.aspx?type=web`). Link to those pages, then measure — and re-read every web setting after writing it, because "200" is not proof.
>
> **Ve zkratce.** Tlačítko „připrav důvěrný web“ zvládne většinu zabezpečení přes REST – `MembersCanShare = false` i funkce uzamčení omezeného přístupu jdou. Dvě nastavení ale na webu s vypnutými vlastními skripty z kódu nejdou: `NoCrawl` **webu** skončí 403 i pod správcem kolekce a `SetUseAccessRequestDefaultAndUpdate(false)` vrátí 200, ale `UseAccessRequestDefault` zůstane `true`. Obojí jde stránkami nastavení webu (`srchvis.aspx`, `setrqacc.aspx?type=web`). Odkaž na ně a pak změř – a každé nastavení webu po zápisu přečti znovu, protože „200“ není důkaz.

## Symptom

You build a one-click setup for a site that will hold confidential data (HR files, payroll). The site is a modern team site without a Microsoft 365 group, custom scripts disabled (the default). The setup should exclude the site from search, turn off access requests and member sharing, and activate the lockdown feature. Then:

- `MERGE /_api/web` with `{ "NoCrawl": true }` returns **403**, also when the caller is a site collection admin. The same through CSOM fails too.
- `POST /_api/web/SetUseAccessRequestDefaultAndUpdate(useAccessRequestDefault=false)` returns **200**. Reading the web afterwards still shows `UseAccessRequestDefault: true`.

## Cause

A site with custom scripts disabled removes `AddAndCustomizePages` (`0x40000`) from everyone's effective permissions, including the site collection admin — the effective mask of an admin is `7fffffff/fffbffff` instead of `7fffffff/ffffffff`. Changing `NoCrawl` on the web needs that right, so the write is denied. (`NoCrawl` on a **list** is a different object and stays writable.)

Why the access-request call is a silent no-op was not established; what was measured is that it returns 200 and the value does not change.

## What was measured

On a new site, custom scripts disabled, as a site collection admin:

| Setting | Read via REST | Write via REST / CSOM | Works via |
|---|---|---|---|
| `web.NoCrawl` | yes | **403** | Site settings → Search and offline availability (`/_layouts/15/srchvis.aspx`) |
| `web.ExcludeFromOfflineClient` | yes | not tested | same page |
| Access requests (`UseAccessRequestDefault`, `RequestAccessEmail`) | yes | **200, no change** | `/_layouts/15/setrqacc.aspx?type=web` → afterwards `false` and `''` |
| `web.MembersCanShare` | yes | `MERGE /_api/web` → 204, persisted | — |
| Limited-access user permission lockdown (site feature `7c637b23-06c4-472d-9a9a-7c175762c5c4`) | `site/features/GetById('…')` (`odata.null` when inactive) | `POST /_api/site/features/add` → active | — |
| `site.GroupId` | yes | — | — |

## Fix

1. Do through REST what REST can do: `MembersCanShare`, the lockdown feature, list-level `NoCrawl`, unique permissions on lists and folders.
2. For web `NoCrawl` and access requests, show a link to the settings page and name it as a manual step — not as "done".
3. After any write to a web setting, read the value back and report what you read. A step that returned 200 but did not change the value is a deviation, not a success.
4. Show the result as a measurement: each setting verified, deviating, or "could not be read" — never "OK" for something that was not read.

## Notes

- External sharing for the site is set in the SharePoint admin center and is not readable with delegated site permissions; show it as "not measured" with the path to the admin center.
- If you script this with PnP PowerShell (for example [Set-SiteAccessRequestSettings.ps1](../../scripts/permissions/Set-SiteAccessRequestSettings.ps1)), re-read `UseAccessRequestDefault` and `RequestAccessEmail` after the change. Whether `Set-PnPRequestAccessEmails -Disabled` is affected the same way on a no-script site was not tested.
- Related: [Reindex a library from code works even on a no-script site](../rest-api/reindex-library-from-code-works-under-noscript.md) — the no-script block covers the web, not every object below it.
