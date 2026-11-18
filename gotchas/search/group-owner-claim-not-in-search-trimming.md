---
title: "An owners-only library on a group-connected site is indexed, yet Search shows it to nobody — the group owners claim does not count for security trimming"
short-title: Group owners claim is ignored by search trimming
summary: "When the only path to content is the site's Owners group, and that group holds just the Microsoft 365 group owners claim (`…_o`), the crawler indexes everything but query-time trimming hides it from every owner; REST access works, so it looks like an indexing bug. Prove it with the crawl log and a direct-grant A/B file; fix by granting a principal that trimming expands (a populated SharePoint group or an Entra group)"
tags: [search, security-trimming, permissions, m365-groups, owners, crawl-log, rag, troubleshooting]
applies-to: SharePoint Online, group-connected team sites (Search REST / KQL and anything built on it — RAG, AI assistants, custom search)
last-reviewed: 2026-11-18
---

# An owners-only library on a group-connected site is indexed, yet Search shows it to nobody

> **Bottom line.** On a site connected to a Microsoft 365 group, the SharePoint **Owners** group usually contains a single member: the group owners claim `c:0o.c|federateddirectoryclaimprovider|<groupId>_o`. Permission checks (REST, opening the file) honour that claim. Search **security trimming does not**: content whose ACL reaches people *only* through the Owners group is crawled and indexed, but every query returns 0 for every owner. Members are fine, because the members claim (`…|<groupId>` without `_o`) is expanded at query time.
>
> **Ve zkratce.** Na webu se skupinou M365 má skupina Vlastníci obvykle jediného člena – deklaraci vlastníků skupiny (`…_o`). Kontrola oprávnění (REST, otevření souboru) ji bere, **ořez výsledků Search ne**: obsah, ke kterému vede přístup jen přes Vlastníky, je prošlý a v indexu, ale dotaz vrátí 0 každému vlastníkovi. Členové jsou v pořádku – členskou deklaraci Search rozbalí.

## Symptom

- A library with broken inheritance (for example "only owners and an app's admin groups") returns `TotalRows: 0` for a `Path:"…/Library/*"` query.
- The person asking is a group owner **and** site collection admin; REST reads the library with full rights; the files open fine.
- `NoCrawl` is false, `Hidden` is irrelevant, versions are published, no moderation, no IRM, no default label — and a sibling library that inherits the site's permissions returns hundreds of results.
- Reindexing the library (Advanced settings → *Reindex document library*) changes nothing, even after half an hour.

## Cause

The crawler indexes the library normally. The query-time security token simply doesn't match the ACL. The ACL lists the Owners SharePoint group plus, typically, app role groups that nobody has populated yet. The Owners group holds only the `_o` claim, and that claim is not part of what search uses to trim results. The ACL therefore names nobody search can match, so the content is invisible to everyone, owners included.

You won't notice this on inheriting content: its ACL also contains the Members group, and the members claim is expanded at query time.

## How to prove it (in this order)

1. **Is it a query problem?** Run the same `Path:` query against a sibling library. If that one returns results, your query is fine.
2. **Is it indexed at all?** Read the crawl log for the library URL: CSOM `DocumentCrawlLog.GetCrawledUrls`, see [The crawl log DOES exist in SharePoint Online](crawl-log-exists-in-spo-via-csom.md). Rows with `ErrorCode 0` and `NoIndex false` and a recent `TimeStampUtc` mean the content **is** in the index, so stop reindexing.
3. **A/B the trimming.** Upload a test file to the library and give the asking user **direct** Read on that one file. Do the same in an inheriting library as a control. After the security pass (about 10 minutes), the file with the direct grant shows up and nothing reachable only through Owners does. Delete the test files to the recycle bin afterwards.
4. Read the Owners group: `/_api/web/AssociatedOwnerGroup/Users`. If it lists only `…federateddirectoryclaimprovider|<id>_o` and `SHAREPOINT\system`, you've found it.

## Fix

Give the content a principal that search expands:

- populate the SharePoint group the app grants access to (for example its admins or editors group) with the people who should find the content, or
- grant an Entra security group or the Microsoft 365 group's **members** claim, if every member may read it.

Don't "fix" this by adding the site collection admin. Being a site collection admin doesn't help search trimming either.

## Notes

- If you build an admin-only area that is also meant to be found (a knowledge source for AI, an in-app search), check that its ACL names somebody beyond the Owners group. Empty role groups plus owners-through-a-claim means nobody can find it.
- Data lists read only through REST are unaffected: REST permission checks honour the `_o` claim.
- Related: [Site missing from the index looks like a permissions problem](site-missing-from-the-index-looks-like-a-permissions-problem.md) covers the opposite case. There the content is missing from the index; here it's indexed but trimmed.
