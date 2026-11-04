---
title: Root site swap refuses hub sites, and any site Publishing ever touched
summary: "`Invoke-SPOSiteSwap` rejects a source or target that is a hub site or associated with one, and rejects a source where the Publishing feature was *ever* activated — not just currently; plan the unregister/reassociate dance, and never activate Publishing on the site you intend to promote"
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
- **Neither site may be a hub site or associated with a hub.** The documented procedure is to unregister or disassociate, swap, then register or reassociate.
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

By default a redirect is left at the source address, so links to `/sites/new-intranet` keep working. **No redirect is created for the archived old root**, so anything that lived on it — lists people had bookmarked, in particular — answers on a new address and every saved link to it breaks.

## Fix

- **Check both blockers before you promise a cut-over date.** Hub registration and association are reversible in minutes; Publishing is not reversible at all. Verify them on the actual source site, not on a site built the same way.
- **Script the hub dance as part of the cut-over,** not as a thing somebody remembers: unregister the hub or disassociate, swap, then restore exactly the previous hub topology. Record what was associated to what beforehand — after the swap there is nothing left to read it from.
- **Treat Publishing as a one-way door on any site you might ever promote.** If a site is a candidate for the root, say so where people administer it; "we'll just turn it off again" does not work here.
- **Plan for the archived root's URLs.** Decide the archive address in advance, and tell the people who use what lived there. Content survives the move intact; addresses do not.
- **Capture the root's own settings first.** Featured links, external sharing and site permissions are the three that are known to differ; compare them on the source before the swap and verify them after.

## Source

[`Invoke-SPOSiteSwap`](https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/invoke-spositeswap?view=sharepoint-ps) — Microsoft Learn, read 2026-11-04.
