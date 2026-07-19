---
title: "Markdown vs DOCX vs site pages: choosing a knowledge format for RAG on SharePoint"
tags: [search, rag, files, markdown, architecture]
applies-to: SharePoint Online
last-reviewed: 2026-07-16
---

# Markdown vs DOCX vs site pages: choosing a knowledge format for RAG on SharePoint

> **Bottom line.** For the machine half of a SharePoint RAG pipeline, Markdown wins outright — best extraction, best token efficiency, and it's full-text indexed despite what the docs imply. Pages and Word win authoring. So author where the UX is, and publish a Markdown derivative for the machine.
>
> **Ve zkratce.** Pro strojovou půlku RAG pipeline nad SharePointem vyhrává Markdown na celé čáře – nejlepší extrakce, nejlepší efektivita tokenů, a přes tvrzení dokumentace je fulltextově indexovaný. Stránky a Word vyhrávají v psaní. Piš tedy tam, kde to vyhovuje lidem, a pro stroj publikuj Markdown derivát.

You're building (or feeding) an AI assistant that answers questions from organizational knowledge stored in SharePoint — a query-time RAG pipeline over SharePoint Search, a Copilot-adjacent tool, or your own agent. The question this guide answers: **in what format should that knowledge live?**

The candidates people actually consider: **site pages** (modern .aspx), **Word documents** (.docx), **Markdown files** (.md), and — often by accident — **list items** with rich-text columns.

## TL;DR decision table

| | Site pages (.aspx) | DOCX | Markdown (.md) | List items |
|---|---|---|---|---|
| Full-text in search index | ✅ HTML handler | ✅ | ✅ **despite the official table** ([details](../gotchas/search/md-is-fulltext-indexed-despite-the-docs.md)) | ✅ (but see caveat) |
| Text extraction for the LLM | ❌ worst — rendered page = chrome + scripts around the content | ⚠️ needs a parser (mammoth etc.); comes out as flat text, structure lost | ✅ read the file, done — structure intact | ⚠️ HTML string in a column; only reachable if your pipeline handles items at all |
| Markup overhead per token | ❌ high (before stripping) | ⚠️ n/a after extraction, but binary transfer + parse cost | ✅ minimal, and the markup *is* meaning | ⚠️ depends on stored HTML |
| Authoring UX in M365 | ✅ page editor | ✅ Word | ❌ no first-class browser editor | ✅ if an app provides the form |
| Versioning, permissions, approval | ✅ | ✅ | ✅ (it's a library file) | ✅ |

For the machine half of the pipeline, Markdown wins outright: it reads best by a wide margin (extraction quality, token efficiency) **and** — despite what the official parsed-file-types table implies — SharePoint Online full-text indexes it, so discovery works too. The real trade-off left on the table is **authoring UX**: pages and Word are where humans write comfortably, Markdown isn't (yet) first-class to edit in M365.

## How a query-time RAG pipeline sees SharePoint

The common shape — no separate vector index, everything security-trimmed at query time:

1. **Discover** candidates via `/_api/search/query` (KQL, often filtered `IsDocument:1`).
2. **Deep-read** the top few hits: download the file and extract text into a fixed character/token budget.
3. **Synthesize** with the extracted text as numbered sources.

Each format behaves very differently in steps 1 and 2.

## Format by format

### Site pages — great discovery, terrible extraction

Pages are parsed by the HTML format handler, so their content is fully searchable — best-in-class discovery. But when the pipeline deep-reads a page, the cheap approach (fetch the page URL) returns the **fully rendered page**: suite chrome, scripts, embedded JSON state — often 100+ KB wrapping a few KB of actual content. Pipelines then strip tags with a regex and hope; if the fetch is truncated to fit a budget, the real content can fall *behind* the cutoff entirely.

The authored content actually lives in the `CanvasContent1` field of the SitePages item — much closer to the source, but it's web-part JSON mixed with HTML fragments, so extracting it cleanly is nontrivial too (see [creating modern pages via REST](../gotchas/rest-api/create-modern-page-via-rest-sitepages.md) for what that field looks like). If your pipeline reads pages, read `CanvasContent1` and strip that, rather than fetching the rendered page.

### DOCX — good discovery, lossy extraction

Fully indexed, so discovery is fine. Extraction requires a real parser (mammoth in the browser, or a server-side library), which costs a download of the whole binary (documents are commonly megabytes for pages of text) plus parse time — and typical raw-text extraction **flattens the structure**: headings, lists and tables melt into undifferentiated paragraphs. The LLM still gets the words, but loses the outline that makes a knowledge article skimmable, and tables often become word soup.

Where DOCX shines is authoring: everyone has Word, tracked changes, comments, co-authoring.

### Markdown — the machine-native format

For the reading half, Markdown is close to ideal:

- The file **is** the text — `fetch` + read, no parser, no server round-trip.
- Structure survives *in-band*: `#` headings, lists, tables, code fences cost single characters instead of kilobytes of markup, and LLMs are heavily trained on Markdown — they follow its structure natively.
- Practically the whole character/token budget carries signal instead of scaffolding.

And the discovery half works too — with an asterisk worth knowing about. The official parsed-file-types table doesn't list `.md`, which reads as "bodies never reach the index". **A live probe says otherwise: SharePoint Online full-text indexes `.md` bodies** (verified via `/_api/search/query` with the hit highlight coming from the body — [full story](../gotchas/search/md-is-fulltext-indexed-despite-the-docs.md)). If this is load-bearing for your design, spend the two minutes re-running that probe on your tenant; the docs and the service clearly move at different speeds.

Metadata still pays off — not as a workaround, but as quality: rich Title/description/keyword columns (or a precomputed AI summary column written by a background job) lift ranking and give the pipeline a cheap high-signal snippet without re-reading the file.

Markdown's real weakness in M365 is authoring: there's no first-class browser editor, so either your authors are comfortable in VS Code/Typora-land, or an app generates the files (see below).

### List items — fine for apps, invisible to document pipelines

Rich-text stored in multiline columns is indexed for search *in general*, but document-oriented RAG pipelines commonly filter to `IsDocument:1` — and then list-based knowledge **never even enters the candidate set**. The content is also typically wrapped in app-specific HTML and reachable only through the app's UI.

If your knowledge base is an app backed by lists (a common and perfectly good design for the *human* experience), treat AI as a second consumer: **publish a file derivative** of each approved article into a document library.

## Token economics — with the numbers

Deep-read budgets are finite (thousands of characters per source, not millions), and every character of wrapper markup displaces a character of content. The measured version: the **same ~500-word article** costs **573 tokens as Markdown, ~541 as clean-extracted DOCX, 612 as extracted PDF** (page furniture, re-tokenized per page) — but **3,213 tokens** if you dump the raw `document.xml`, and **1,236** if you feed a page's `CanvasContent1` field verbatim instead of stripping it. Same budget, wildly different amounts of usable knowledge — and retrieval quality follows.

The lesson isn't "pick a format", it's "**extract cleanly, whatever the format**". Full method, per-format breakdown, a Czech-vs-English language tax, and a reproducible harness: **[What each format costs the model](token-cost-of-sharepoint-content-formats.md)**.

## A pragmatic architecture

**Author where the UX is; publish where the machine reads.**

1. Keep authoring in whatever has the best human workflow — Word, a page editor, or an app with forms and approval.
2. On publish/approve, **generate a Markdown derivative** into a dedicated document library (one file per article, front-matter or columns for category/tags/owner). The source of truth stays where it was; the `.md` file is a build artifact, regenerated on every change.
3. Add **summary/keyword metadata columns** to the library (precomputed if you can) — bodies are indexed, but curated metadata lifts ranking and gives the pipeline a cheap high-signal snippet.
4. Point your RAG pipeline (or its "authoritative sources" allowlist, if it has one) at that library.

This gets you page/Word-grade authoring, Markdown-grade extraction, and metadata-grade discovery — without asking either your authors or your pipeline to compromise.

## Related

- [Don't trust the parsed-file-types table: SPO does index `.md`](../gotchas/search/md-is-fulltext-indexed-despite-the-docs.md)
- [Create a modern page via REST — `CanvasContent1` is JSON](../gotchas/rest-api/create-modern-page-via-rest-sitepages.md)
- [Search queries that actually work](search-queries-that-actually-work.md)
