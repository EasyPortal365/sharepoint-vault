---
title: Graph Search returns 0 hits — you passed the user's question as the queryString
tags: [search, graph, kql, ai, rag]
applies-to: Microsoft Graph Search API (v1.0), Exchange Online, Teams
last-reviewed: 2026-07-17
---

# Graph Search returns 0 hits — you passed the user's question as the `queryString`

## Symptom

You wire `POST /search/query` into an assistant so it can answer from the user's own mail,
calendar or Teams messages. Permissions are consented, the call returns **HTTP 200**, there is
**no error anywhere** — and every result set is empty:

```json
{ "value": [ { "hitsContainers": [ { "hits": [], "total": 0 } ] } ] }
```

The assistant then tells the user *"I don't have access to your Teams history"* — which is false,
and the most expensive part of this bug: **it fails silently**. Zero hits is indistinguishable from
"the user genuinely has nothing like that."

## Cause

The question went into `queryString` verbatim:

```json
{ "entityTypes": ["chatMessage"], "query": { "queryString": "what did I last discuss in Teams?" } }
```

Search treats that as full text. It looks for the *words* "what did I last discuss in Teams" inside
messages. Nobody writes that, so nothing matches.

Two distinct problems hide in one sentence like that:

1. **A question is not a query.** It needs translating into keywords first.
2. **"Last" / "what's new" is not a search at all** — there are no keywords to extract. It's a
   *listing* request, and keyword search is the wrong tool for it.

## Fix

### 1. Translate the question into keywords (LLM step)

Add a cheap model call that turns the question into keywords, and let it return **three** outcomes,
not one:

| Outcome | Meaning | queryString |
|---|---|---|
| keywords | question has a topic | `budget marketing` |
| **empty** | question asks about recency only | `*` (see below) |
| skip | question isn't about the user's data at all ("translate this") | *don't call Search* |

**Empty keywords are a valid result, not a failure** — do not "fall back" to the raw question there,
that's the bug you're fixing. The `skip` outcome is worth having on its own: it saves one Search call
per enabled source and answers faster.

Tip: a person's name works as a plain keyword — Teams search matches the **sender name** too, so you
rarely need `from:`.

### 2. For recency, lean on the default sort — don't sort yourself

> ⚠️ **Correction (2026-07-17, verified live): `queryString: "*"` does NOT work for `chatMessage`
> alone.** The response comes back `200 OK` with **`"searchTerms": []`** and `"total": 0` — Graph
> discarded the wildcard, had nothing to match, and returned nothing. The `*` example in the docs is
> for `entityTypes: ["chatMessage", "message"]` (**the interleaving combination**), and it does not
> generalize to a single entity type. Treat the rest of this section as the *goal* (lean on the
> default date sort), not as a working recipe for `*` — and **check `searchTerms` in the response**:
> if it's empty, your query never became a query, no matter what the docs example shows.

`*` is documented (see the interleaving example that combines `chatMessage` and `message`) and the
default sort is what makes recency work at all — a detail that's easy to miss:

> **`message` and `event` are sorted by date**, all SharePoint/OneDrive/person types by relevance.
> — *Microsoft Search API overview*

and for Teams messages:

> The search results are ordered by descending **dateTime**.
> — *Search Teams messages*

So `queryString: "*"` **already returns the newest items**. Meanwhile a custom sort is rejected:

> The search API doesn't support custom sort for **acronym, bookmark, message, chatMessage, event,
> person, qna, externalItem**.

Passing `sortProperties` for those types returns **HTTP 400**. Relevance-boosting `enableTopResults`
is fine for `message`/`chatMessage` keyword searches, but don't turn it on for the `*` listing — it
undermines the only thing making that query work.

### 3. Date filters: use only the documented operator per entity type

There is no uniform KQL across entity types. Use what the docs actually show:

| Entity | Documented date filter | Source |
|---|---|---|
| `message` (mail) | `received>=2026-07-10` | *Searchable email properties* (KeyQL) |
| `chatMessage` (Teams) | `sent>2026-07-09` — **no `>=`** | *Search Teams messages*, scope terms table |
| `event` (calendar) | **none documented** | no scope-terms table exists |

Because the Teams operator is `>` without the equals sign, shift the date back one day so the
boundary day stays inside the window:

```ts
// documented: sent>2022-07-14 · from:bob · to:bob · hasAttachment:true · IsMentioned:true · mentions:<id>
const dayBefore = shiftDays(sinceIso, -1);
queryString = `${keywords || '*'} sent>${dayBefore}`;
```

For `event`, send keywords only. Guessing a filter is not free: **bad KQL is a 400, which takes the
whole source down**, whereas no filter merely widens the results. Search wide rather than not at all.

Validate the date where you build the query, not at the caller — if an LLM produced it, the "it's
always `YYYY-MM-DD`" contract is held up by a prompt, which is not a guarantee:

```ts
// "2026-13-45" must not reach KQL: `new Date(2026, 12, 45)` silently rolls over to 2027-02-14
function parseIsoDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], da = +m[3];
  const d = new Date(y, mo - 1, da);
  return (d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da) ? d : null;
}
```

### 4. Calendar deserves a different endpoint

Since `event` has no documented date filter, time-bounded calendar questions ("meetings next week")
are better served by `/me/calendarView?startDateTime=…&endDateTime=…` than by Search. Different data,
though: `calendarView` covers the future, Search mostly the past.

## Why this bites specifically in AI/RAG code

Retrieval pipelines built on SharePoint Search usually already have the "question → keywords" step.
When you later bolt on a second retrieval path for Graph sources, it's easy to reuse the *interface*
and skip the *steps*. Both paths then look correct in review, and only one of them works — silently.

**If you have two search branches side by side and only one translates the question, the other is
broken and nothing will tell you.** Check what fills `queryString`.

Don't merge the two generators into one prompt either: SharePoint KQL properties (`Write>=`,
`filetype:`, `author:`) don't exist in the Exchange/Teams index, and corpus/people modes make no
sense there. One generator per index.

## References

- [Use the Microsoft Search API to query data](https://learn.microsoft.com/graph/api/resources/search-api-overview) — sort order, known limitations
- [Search Teams messages](https://learn.microsoft.com/graph/search-concept-chat-messages) — scope terms table
- [Search with interleaved results](https://learn.microsoft.com/graph/search-concept-interleaving) — the `"*"` example
- [Searchable email properties](https://learn.microsoft.com/purview/edisc-search-mailboxes) — `received`/`sent` operators
