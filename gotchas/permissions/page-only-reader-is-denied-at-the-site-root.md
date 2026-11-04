---
title: A user with Read on one page only is denied at the site root URL — link to the page, not the site
short-title: Page-only reader is denied at the site root
summary: "When a principal has Read on a single page in Site Pages and only Limited Access on the site, opening the site URL ends on AccessDenied.aspx even though the page itself opens fine — so a link that falls back to the site root breaks exactly for the narrow audience it was meant for"
tags: [permissions, pages, links, security]
applies-to: SharePoint Online
last-reviewed: 2026-11-04
---

# A page-only reader is denied at the site root

> **Bottom line.** Give a group Read on one page in *Site Pages* (unique permissions on that item) and nothing else on the site, and its members can open `…/SitePages/App.aspx` — but `https://tenant.sharepoint.com/sites/x` sends them to `AccessDenied.aspx`. The site URL is checked against site-level permissions before it redirects to the welcome page. Any link for such an audience must point at the page itself; "fall back to the site root" is only safe for site members.
>
> **Ve zkratce.** Skupina se Čtením jen na jedné stránce v knihovně Stránky webu (na webu tedy Omezený přístup) stránku otevře, ale adresa webu ji pošle na „Přístup odepřen“ – web se kontroluje dřív, než přesměruje na uvítací stránku. Odkaz pro takové publikum musí mířit na stránku, kořen webu je bezpečná záloha jen pro členy.

## Symptom

A common pattern for "let people outside the site use one app page": break inheritance on the page item, grant a group Read on it, leave the site itself untouched (the group ends up with *Limited Access* on the web). Tested with an account that is only in that group:

| URL | Result |
|---|---|
| `…/sites/x/SitePages/Home.aspx` | 200, page and its web part render |
| `…/sites/x` | redirect to `/_layouts/15/AccessDenied.aspx?Source=…%3Fsw%3Dauth` |

Everything works when you test with the page URL from your browser history; the failure only shows up through a link that was built as "page if known, otherwise site URL".

## Cause

A request for the site URL is authorized against the **web** before SharePoint resolves the welcome page. *Limited Access* does not include *View Pages* on the web, so the request is denied even though the redirect target would have been readable. The page URL is authorized against the **item**, where the group does have Read.

## Fix

- Build links for page-only audiences from the page URL (`…/SitePages/<page>.aspx`), never from the web URL — not even as a fallback.
- If only the app knows its page (for example from the SPFx page context), let it store that URL somewhere the narrow audience can read — a settings list the group has Read on — and build links from there.
- Treat a stored or configured URL that is not an `.aspx` under the same web (site root, `/_layouts/…`, another site sharing the URL prefix) as "page unknown".

## How to test it

Use an account that is only in the narrow group, and start from the link users will actually click (web part, email, card) — not from a URL you type. Then open the site root once to confirm the denial is expected rather than a misconfiguration.

## Sources

- [Permission levels in SharePoint](https://learn.microsoft.com/sharepoint/understanding-permission-levels) — Limited Access is assigned automatically when someone gets access to one specific item and grants nothing beyond it; in the site-permissions table *View Pages* is not part of Limited Access.
- Measured on a SharePoint Online tenant with an account that was only in the page-reader group (site URL → AccessDenied.aspx, page URL → 200).
