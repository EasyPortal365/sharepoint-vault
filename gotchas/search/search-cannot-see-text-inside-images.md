# SharePoint Search cannot see text inside images — and what that does to RAG

*Last reviewed: 2026-09-02*

## Symptom

A user asks about something that demonstrably *is* in a document — a discount code on a
flyer, a value in a screenshot of a table, a number on a scanned page. Search returns
nothing useful, and an AI assistant grounded on Search answers "I could not find that",
**while listing the very document among its sources**.

## Cause

The crawler indexes the **text layer** only. Anything rendered as pixels — an embedded
flyer, a chart image, a photographed table, a scanned page — is invisible to it, so:

- keyword search cannot match on words that appear only in the picture;
- a RAG pipeline that (a) searches by keyword and (b) reads the top hits is therefore
  in a **closed loop**: the document it could read is one it can never find.

The trap is that the document *does* surface for unrelated reasons (recency listings,
fallback result sets, another matching phrase), so the failure reads as "the AI is bad at
reading", not as "the index does not contain that text".

## What to do

**1. Do not let the fallback path skip deep reading.** If keyword search returns nothing
and you fall back to "most recent documents in scope", read the top few **in full**
(including image transcription) instead of showing snippets. That covers the ad-hoc case.

**2. Get image content into the index — that is the only real fix.** Extract the images,
transcribe them (OCR or a vision model), and write the result into a **crawled managed
property** on the item, e.g. a plain text column you provision yourself:

```
Doc → extract embedded images (pdfjs-dist / OOXML unzip)
    → transcribe (vision / OCR)
    → write into a text column on the list item  ← this IS indexed
```

Site columns are crawled, so from the next crawl the words in the picture are searchable
like any other text. This also fixes scanned PDFs, which otherwise have no text layer at
all.

**3. Beware the re-ranker.** If you use an LLM to pick which hits to read in depth, it
scores them from **search snippets** — which come from the text layer. A document whose
answer lives only in an image looks irrelevant and gets dropped exactly when it matters.
On the fallback path, rank by date (or another content-independent signal) instead.

## Do not reach for

- **Premium OCR add-ons** as an assumption. Image/OCR enrichment in SharePoint is a paid
  tier; building a core capability on it excludes every tenant without that licence.
  Own extraction keeps it available everywhere.
- **"Just tell users to attach the file."** It works, but only for users who already know
  which document holds the answer — the ones who need search the least.

## How to confirm it in two minutes

Take a document whose key value exists only in an image, then compare:

```
/_api/search/query?querytext='"<value from the image>"'   → no hit
/_api/search/query?querytext='"<phrase from the text>"'   → hit
```

Two queries against the same file settle whether you are looking at an indexing gap or a
retrieval bug — and stop you from tuning the retriever for a problem it cannot solve.
