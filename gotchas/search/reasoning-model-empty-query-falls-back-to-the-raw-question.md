---
title: RAG finds nothing that SharePoint Search finds — the reasoning model spent the whole token cap thinking
short-title: RAG finds nothing — a reasoning model used the token cap for thinking
summary: GPT-5/o-series count hidden reasoning in max_completion_tokens; a small cap on the query-generator call returns empty text (HTTP 200), and a raw-question fallback ANDs every word in KQL
tags: [search, kql, ai, rag, azure-openai]
applies-to: SharePoint Online Search REST, Azure OpenAI reasoning models (gpt-5*, o-series)
last-reviewed: 2026-10-12
---

# RAG finds nothing that SharePoint Search finds — the reasoning model spent the whole token cap thinking

> **Bottom line.** Reasoning models count their hidden thinking against `max_completion_tokens`, so a "cheap" helper call with a cap of a few hundred tokens can come back with **empty text and HTTP 200**. If your RAG pipeline then falls back to searching the user's raw question, KQL ANDs every word ("what", "do", "we", "know"…) and SharePoint returns nothing — while the same topic typed into the SharePoint search box is the first hit.
>
> **Ve zkratce.** Reasoning modely počítají skryté přemýšlení do `max_completion_tokens`, takže „levné“ pomocné volání se stropem pár set tokenů vrátí **prázdný text a HTTP 200**. Když pak RAG záložně hledá celou otázku uživatele, KQL spojí všechna slova přes AND („co“, „víme“, „o“…) a SharePoint nenajde nic – přestože totéž téma ve vyhledávacím poli SharePointu vyjde jako první.

## Symptom

An assistant answers from SharePoint content through a classic pipeline: a small model call turns
the question into 2–3 keyword queries, the queries go to `/_api/search/query`, the hits become the
context. After switching the helper call to a GPT-5-family deployment:

- Questions about things that clearly exist (an event page, a safety rule) get *"I found nothing
  specific"*, sometimes followed by a summary of unrelated newest pages.
- The same words typed into SharePoint search return the right page **first**.
- No errors anywhere. Every call is `200 OK`.
- It is **intermittent** — the same question sometimes works.

## Cause

Two defects that are harmless alone and fatal together.

### 1. The cap includes reasoning tokens

For reasoning models, Azure OpenAI replaces `max_tokens` with `max_completion_tokens`, and that limit
covers **both** the visible output and the hidden reasoning. A query generator with a long system
prompt (classification rules, KQL rules, examples) can easily think for 300+ tokens before writing
a single word. When the cap is reached first, the response is:

```json
{ "content": "", "usage": { "promptTokens": 1539, "completionTokens": 300 } }
```

`completionTokens == maxTokens` with empty content is the fingerprint. Measured live against a
`gpt-5-mini` deployment (`reasoning_effort: "low"`), same prompt, 5 runs per cell:

| Question | cap 300 | cap 2000 |
|---|---|---|
| short event question | 3 × empty | 0 × empty (max 460 used) |
| short policy question | 5 × empty | 0 × empty (max 584 used) |

It is stochastic: the reasoning length varies run to run, which is why it "sometimes works".

### 2. The fallback searches the raw question

Empty output is not an exception, so the parser's "nothing usable → search the question itself"
branch kicks in. In KQL, free-text terms without an operator are combined with **AND**, so

```
(what do we know about the open day event) Path:"https://contoso.sharepoint.com/sites/intranet/*" IsDocument:1
```

requires a document containing *every* word, including "what", "do", "we" and "know". Nothing does.
The pipeline then often degrades further (e.g. "list newest documents in scope"), and the model
politely summarizes irrelevant pages.

## Fix

1. **Give helper calls reasoning headroom.** Cap = expected output + a fixed reserve (≈1,500–1,700
   tokens worked for query generation and re-ranking). The cap is only a ceiling — you pay for tokens
   actually used, and classic models are unaffected because their output length comes from the
   instructions, not from the cap.
2. **Treat empty output as a failure, not as "no queries".** Log it with the usage numbers; if
   `completionTokens` equals the cap, you hit this gotcha.
3. **Make the fallback usable on its own.** Never send the raw sentence. Strip stop words and send
   the remaining terms twice — once ANDed, once ORed:

   ```ts
   const STOP = ['what', 'do', 'we', 'know', 'about', 'the', 'is', 'how', 'where', 'who' /* + your languages */];
   function fallbackQueries(q: string): string[] {
     const words = q.replace(/[^0-9A-Za-zÀ-ž\s-]+/g, ' ').split(/\s+/)
       .filter(w => w && STOP.indexOf(w.toLowerCase()) === -1);
     if (words.length === 0) return [q];
     return words.length === 1 ? words : [words.join(' '), words.join(' OR ')];
   }
   ```

   Stripping punctuation also removes stray `(`, `)` and `"` that could break out of your scope
   clause (see [kql-or-escapes-your-scope-filter](kql-or-escapes-your-scope-filter.md)).
4. **Check every helper call, not just the one that failed.** Re-rankers, title generators,
   "suggest next step" calls and column-fill prompts all tend to have caps of 16–400 tokens copied
   from the GPT-4 era.

> ⚠️ **Watch for coupled limits.** If your backend uses `maxTokens` for anything else (rate
> limiting, billing classification of "internal" vs "user" calls), raising the cap can move calls
> into a different bucket. Keep the new cap below any such threshold.

## How to diagnose quickly

Wrap `window.fetch` on the page and log two things: the `querytext` sent to `/_api/search/query`,
and the JSON returned by the query-generator call. If the KQL contains the user's sentence verbatim,
or the generator returned `""` with `completionTokens` equal to the cap, you are looking at this
gotcha — not at a ranking, permissions or crawl problem.

## Related

- [graph-search-raw-question-returns-nothing](graph-search-raw-question-returns-nothing.md) — the same
  raw-question failure against Microsoft Graph Search (mail, Teams).

## References

- [Azure OpenAI reasoning models](https://learn.microsoft.com/azure/ai-foundry/openai/how-to/reasoning) — `max_completion_tokens`, reasoning tokens, `reasoning_effort`
- [Keyword Query Language (KQL) syntax reference](https://learn.microsoft.com/sharepoint/dev/general-development/keyword-query-language-kql-syntax-reference) — implicit AND between free-text terms
