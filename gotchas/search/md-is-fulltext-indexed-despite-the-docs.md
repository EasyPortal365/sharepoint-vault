---
title: "Don't trust the parsed-file-types table: SPO does full-text index .md"
tags: [search, files, markdown, documentation]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# Don't trust the parsed-file-types table: SharePoint Online full-text indexes `.md`

> **Bottom line.** The official parsed-file-types table omits `.md`, but live SharePoint Online full-text indexes Markdown bodies anyway — treat `.md` as fully searchable, and run a two-minute live probe before you architect around any capability table.
>
> **Ve zkratce.** Oficiální tabulka parsovaných formátů `.md` neuvádí, ale živý SharePoint Online těla Markdownu stejně plnotextově indexuje – ber `.md` jako plně prohledávatelný a než na nějaké tabulce schopností postavíš návrh, ověř to dvouminutovou živou zkouškou.

## Symptom

You design a knowledge base or RAG architecture around the assumption that **Markdown bodies are invisible to SharePoint Search**, because the official [table of default crawled extensions and parsed file types](https://learn.microsoft.com/sharepoint/technical-reference/default-crawled-file-name-extensions-and-parsed-file-types) doesn't list `.md` anywhere — the Text handler covers `.txt`/`.csv`, the HTML handler covers `.aspx`/`.html`, and Markdown appears in neither. Docs read, conclusion drawn, mitigations planned.

Then a two-minute live test contradicts the whole thing.

## Cause

**The table is stale for SharePoint Online.** Live SPO parses Markdown bodies just fine. Verified July 2026 on a production tenant: upload a `.md` file whose *body* (not filename) contains a unique word, wait about a minute, then hit the classic search endpoint —

```
GET https://contoso.sharepoint.com/sites/kb/_api/search/query
      ?querytext='dandelion filetype:md'
Accept: application/json;odata=nometadata
odata-version: 3.0
```

The file comes back, and the give-away is `HitHighlightedSummary`:

```json
"summary": "<ddd/><c0>dandelion</c0>.<ddd/>"
```

The highlight is taken **from the body** — genuine content indexing, not a filename or metadata match. Both the modern library search (`?q=` / Microsoft Search) and the classic REST endpoint agree.

## Fix

- Treat `.md` as a first-class, fully searchable format in SharePoint Online.
- The meta-fix: **when an official capability table is load-bearing for your design, spend two minutes on a live probe before you architect around it.** The recipe: unique word in the body, upload, query `word filetype:xyz`, and check that `HitHighlightedSummary` highlights the word — that last part is what distinguishes body indexing from a name/metadata hit.

## Notes

- The table still matters where it was born: SharePoint **Server**, where the handler list is real and extensible via iFilters. SPO evolves ahead of its own documentation.
- Tested on one production SPO tenant (July 2026), indexed within ~a minute of upload. If this behavior is load-bearing for you, re-run the probe on *your* tenant — it costs two minutes.
- Filename, Title and metadata columns are indexed regardless of format — that part was never in question.
- Consequence for AI/RAG pipelines: with bodies indexed, Markdown wins the machine-channel comparison outright — clean 1:1 text extraction *and* full discovery. See [choosing a knowledge format for RAG](../../guides/choosing-a-knowledge-format-for-sharepoint-rag.md).
