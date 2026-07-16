---
title: ".md files are found by name only — Markdown is not a parsed file type"
tags: [search, files, markdown, rag]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# `.md` files are found by name only — Markdown is not a parsed file type

## Symptom

You store Markdown files in a document library. Search (KQL, the search UI, or `/_api/search/query`) finds them **by filename or Title only** — a query for words that appear *inside* the file returns nothing. The exact same content saved as `.txt` or `.docx` is found immediately.

## Cause

SharePoint's content processing only extracts text from formats it has a **format handler** for, and Markdown is not one of them. The official [table of default crawled extensions and parsed file types](https://learn.microsoft.com/sharepoint/technical-reference/default-crawled-file-name-extensions-and-parsed-file-types) covers the Text handler (`.txt`, `.csv`, …), the HTML handler (`.aspx`, `.html`, `.htm`, …), Office formats, PDF — **`.md` appears nowhere in the list**.

When a file can't be parsed, the index only gets its *properties*: filename, Title, and the library item's metadata columns. That's why name matches work while body matches never do.

Two things make this trap easy to miss:

- The library item behaves like any list item, so metadata search works fine — the gap only shows when you search for body content.
- SharePoint Online has **no "Manage File Types" page and no custom iFilters** — unlike on-prem SharePoint Server, the parsed-format set is fixed. There is nothing to enable.

## Fix

There's no switch to flip; design around it:

1. **Carry the searchability in metadata columns.** Columns on the library item *are* indexed and inherit the document's permissions. Rich `Title`, a description column, keyword/tag columns — or, for AI scenarios, a precomputed summary + keywords written to text columns by a background job. The document is then discoverable even though its body isn't parsed.
2. **Use the `.txt` extension** if nothing depends on `.md`. The Text handler parses `.txt`, and Markdown syntax inside a `.txt` is still perfectly readable for humans, editors, and LLMs. Trade-off: you lose the `.md` icon, preview, and editor associations.
3. **Don't rely on content search for retrieval at all**: if your consumer knows the library/folder, query by path + metadata and fetch the files directly via REST — reading `.md` file bodies works fine; only the *search index* is blind to them.

## Notes

- Don't confuse indexing with other `.md` support: SharePoint/OneDrive can preview and even translate `.md` documents — none of that puts the body into the search index.
- The same gap surfaces in eDiscovery (partially indexed items) and in any RAG pipeline that discovers documents via `/_api/search/query`.
- Ironically, `.md` is one of the *best* formats once a pipeline has found the file — it reads as clean text 1:1 with structure intact. See [Markdown vs DOCX vs site pages for RAG](../../guides/choosing-a-knowledge-format-for-sharepoint-rag.md) for the full comparison.
