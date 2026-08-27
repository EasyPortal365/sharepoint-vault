---
title: "\"Search finds nothing here\" is usually a site missing from the index — not a permissions problem"
tags: [search, kql, index, crawl, rag, copilot, troubleshooting]
applies-to: SharePoint Online (Search REST / KQL, and anything built on it — RAG, custom search, AI assistants)
last-reviewed: 2026-08-27
---

# "Search finds nothing here" is usually a site missing from the index — not a permissions problem

> **Bottom line.** When search returns zero for content a user is plainly looking at, measure **search itself** before touching your code: query the target path, then `*`, then `contentclass:STS_Site`. If the last two return numbers and the first returns zero, your app is innocent — the site is not in the index, and no amount of query tuning will help. Never phrase an empty result as "nothing you have access to": that sends people to check permissions that were never broken.
>
> **Ve zkratce.** Když hledání vrátí nulu pro obsah, na který se uživatel právě dívá, změřte nejdřív **samotné hledání**, ne svůj kód: dotaz na cílovou cestu, pak `*` a pak `contentclass:STS_Site`. Když poslední dva vrátí čísla a první nulu, vaše aplikace je nevinná – web není v indexu a ladění dotazu nepomůže. Prázdný výsledek nikdy neformulujte jako „nic, k čemu máte přístup": pošlete tím lidi kontrolovat oprávnění, která byla celou dobu v pořádku.

## Symptom

A user is standing in a document library, looking at six files. They ask an assistant (or use a search-backed feature) to summarise what is in the library, and get back something like *"I did not find any documents you have access to."*

It reads as a permissions failure. It is not: the same user can open every one of those files.

## Cause

The site is not in the search index. Not blocked, not trimmed — absent.

This happens more often than people expect, including on sites that are weeks old, have `NoCrawl = false` everywhere, and are used daily. Search-backed features have no way to distinguish "the index has nothing for this path" from "there is nothing here", so they report the latter.

## Measure it in three queries

Run these as the affected user (delegated), against the affected site. Requires the `odata-version: 3.0` header on the Search REST endpoint.

```
/_api/search/query?querytext='path:"https://tenant.sharepoint.com/sites/target"'
/_api/search/query?querytext='*'
/_api/search/query?querytext='contentclass:STS_Site'
```

Interpretation:

| result | meaning |
|---|---|
| first = 0, others return numbers | the site is missing from the index — **stop debugging your code** |
| all three = 0 | search is broken or unavailable for this user, not a site problem |
| first returns rows | the index has the content; the bug is in your query or your filters |

The third query is the decisive one: list the site collections it returns and check whether the target site is among them. A real measurement from a live tenant: 72 sites in the index, 17 393 documents visible to the user, and **zero** for the one site in question — while a filename from that site matched a copy stored elsewhere. That pattern is unambiguous.

Also read `NoCrawl` directly rather than assuming, on both the web and each list:

```
/_api/web?$select=Title,NoCrawl
/_api/web/lists?$select=Title,NoCrawl,ItemCount
```

(Resist the habit of adding `$filter=Hidden eq false` here — apps hide their settings lists on purpose, and a hidden list with `NoCrawl = false` still feeds the index. Filtering it out means auditing a different site than the one search sees; see [Enumerate every site from the browser console](enumerate-every-site-from-the-browser-console.md).)

## Fix

- **Ask the site owner to reindex**: Site settings → *Search and offline availability* → **Reindex site**. Then wait for the crawl — do not promise a time; on a large tenant "a few minutes" is not true.
- **For a known, specific library, do not depend on the index at all.** Once your UI knows exactly which library the user means, read it live over REST (`GetList('<server-relative-url>')/items`). That returns names, types, sizes and modified dates immediately, with no crawl latency. Keep the index for anything spanning multiple sites, where nobody expects instant freshness.
- **Say which of the three states you are in.** *Nothing matched* × *outside the configured scope* × *not indexed yet* lead a user to three different places. Collapsing them into a sentence about access is the worst option, because it is the only one that blames the user's permissions.
- **You can detect the mismatch, not just guess it.** If REST tells you the library holds six items and search returns zero for that same path, that discrepancy *is* the fingerprint of a missing index — report it as such, along with what the administrator should do.

## Why it is worth checking before deployment

For anything AI-facing this is not a nice-to-have. "Your assistant cannot find our documents" is the worst possible first impression, it is indistinguishable from a broken product, and it is caused by a setting nobody in the room has looked at. One query per target site during acceptance testing removes the entire class.
