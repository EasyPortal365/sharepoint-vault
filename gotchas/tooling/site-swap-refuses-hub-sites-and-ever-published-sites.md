---
title: Root site swap refuses hub sites, and any site Publishing ever touched
summary: "`Invoke-SPOSiteSwap` rejects a source or target that is a hub site or associated with one, and rejects a source where the Publishing feature was *ever* activated — not just currently; unregistering a hub leaves children appearing associated for up to an hour, so remove the associations explicitly before the swap, and never activate Publishing on the site you intend to promote"
tags: [tooling, powershell, migration, root-site]
applies-to: SharePoint Online
last-reviewed: 2026-11-04
---

# Root site swap refuses hub sites, and any site Publishing ever touched

> **Bottom line.** `Invoke-SPOSiteSwap` is the supported way to put a new site at the tenant root, and it archives the old root instead of deleting it. Two of its preconditions are easy to walk into and expensive to discover late: **neither the source nor the target may be a hub site or associated with a hub**, and **the source is refused if the Publishing feature has ever been activated on it** — currently or at any point in the past. A modern intranet is built out of hubs, so the first one applies to essentially every real rollout; the second is permanent, so one curious click on Publishing disqualifies the site you were going to promote.
>
> **Ve zkratce.** `Invoke-SPOSiteSwap` je podporovaný způsob, jak dostat nový web na kořen tenantu, a starý kořen přitom nemaže, ale odloží na archivní adresu. Dvě její podmínky se snadno přehlédnou a zjistit je pozdě je drahé: **ani zdrojový, ani cílový web nesmí být hub ani k hubu připojený** a **zdrojový web je odmítnut, pokud na něm kdykoli byla zapnutá funkce Publishing** – nejen teď, ale i kdykoli v minulosti. Moderní intranet se z hubů skládá, takže první podmínka platí skoro vždy; druhá je trvalá, takže jedno zvědavé kliknutí na Publishing web, který jsi chtěl povýšit, vyřadí.

## Symptom

The swap refuses to start. The content is untouched and nothing is broken, but the cut-over window closes with the old root still in place — and if the blocker is Publishing, no amount of turning the feature back off helps.

## Cause

Four constraints are documented on the cmdlet, and these are the ones that bite:

- **The target must be the root site or the search centre.** Nothing else can be swapped.
- **Neither site may be connected to a Microsoft 365 group.** A group-connected team site cannot be promoted this way; a communication site can.
- **Neither site may be a hub site or associated with a hub.** The documented procedure is to unregister or disassociate, swap, then register or reassociate. Unregistering is not instant: `Unregister-SPOHubSite` leaves associated sites *appearing* associated **for up to an hour**, and the documented way to speed that up is to call `Remove-SPOHubSiteAssociation` on every child first. Whether the swap's own validation reads that stale state is not documented — not measured here either, so treat a swap fired straight after the unregister as untested rather than safe.
- **If the Publishing feature has previously been activated or is currently activated on the source site, the swap cannot be used.** The wording is "previously been activated" — deactivating it does not restore eligibility.

Two further effects are not refusals but surprises:

- **Featured links on the SharePoint start page stop being displayed** after the swap. Write them down first; they are recreated by hand.
- **External sharing settings and site permissions follow the site, not the address.** The source must already carry the policies the old root had, or capabilities that depended on the root's settings change the moment it is promoted.

```powershell
# ArchiveUrl is mandatory: the OLD root is moved there, not deleted.
Invoke-SPOSiteSwap `
  -SourceUrl  https://contoso.sharepoint.com/sites/new-intranet `
  -TargetUrl  https://contoso.sharepoint.com `
  -ArchiveUrl https://contoso.sharepoint.com/sites/archive-old-root
```

By default a redirect is left at the source address, so links to `/sites/new-intranet` keep working. **Saved links into the old root break regardless**, and not because a redirect is missing: the promoted site now occupies that address, so a request for a list that used to live at the root reaches the new site, which does not have it. Anything people had bookmarked there answers on the archive address from now on, and the documentation describes a redirect only for the source location — so don't plan around one for the archived site.

## Fix

- **Check both blockers before you promise a cut-over date.** Hub registration and association are reversible in minutes; Publishing is not reversible at all. Verify them on the actual source site, not on a site built the same way.
- **Swap first, register the hub afterwards.** This is the one that makes the rest unnecessary: if the site you are promoting is not yet a hub and nothing is associated to it, both hub conditions are satisfied by construction. Where the hub topology does not exist yet — a greenfield intranet, say — build the new root as an ordinary site, swap, *then* register it as the hub and associate the children. A site you intend to promote is a bad candidate for the parent hub while the swap is still ahead of you.
- **If the topology already exists, script the dance** rather than leaving it to whoever is on shift, and in this order: record the topology, `Remove-SPOHubSiteAssociation` for every child, `Unregister-SPOHubSite`, verify that nothing reports as associated any more, swap, `Register-SPOHubSite`, re-associate every child. Record what was associated to what **before** you start — once the associations are gone there is nothing left to read them from. Budget for the gap: while the children are disassociated, they lose the hub's shared navigation.
- **Re-registering does not restore how the hub looked.** `Set-SPOHubSite` carries `Title`, `Logo`, `Description` and `HideNameInNavigation` — it does *not* set the hub's navigation links, which are maintained on the hub site itself. Capture both separately before unregistering.
- **Treat Publishing as a one-way door on any site you might ever promote.** If a site is a candidate for the root, say so where people administer it; "we'll just turn it off again" does not work here.
- **Plan for the archived root's URLs.** Decide the archive address in advance, and tell the people who use what lived there. Content survives the move intact; addresses do not.
- **Capture the root's own settings first.** Featured links, external sharing and site permissions are the three that are known to differ; compare them on the source before the swap and verify them after.

## Source

Microsoft Learn, read 2026-11-04:

- [`Invoke-SPOSiteSwap`](https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/invoke-spositeswap?view=sharepoint-ps) — the swap's own preconditions.
- [`Unregister-SPOHubSite`](https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/unregister-spohubsite?view=sharepoint-ps) — associations may appear to survive for up to an hour.
- [`Set-SPOHubSite`](https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/set-spohubsite?view=sharepoint-ps) — what re-registering can and cannot restore.
- [PowerShell cmdlets for SharePoint hub sites](https://learn.microsoft.com/sharepoint/dev/features/hub-site/hub-site-powershell) — the full cmdlet set.
