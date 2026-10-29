---
title: SharePoint Search finds nothing for a question in an inflected language — add prefix-wildcard stems, and never turn zero hits into "latest documents"
short-title: Inflected-language queries hit 0 — use `stem*`, and zero hits is not a listing
summary: KQL is implicit AND and does not stem Czech/Polish/German forms; add a `stem*` variant in code, relax before giving up, and never serve a date-sorted inventory as sources for a specific question
tags: [search, kql, rag, ai, language]
applies-to: SharePoint Online Search REST (/_api/search/query), Microsoft Graph Search for driveItem/listItem
last-reviewed: 2026-10-29
---

# SharePoint Search finds nothing for a question in an inflected language — add prefix-wildcard stems

> **Bottom line.** SharePoint Search joins bare terms with AND and does not reduce inflected forms to a common stem, so a keyword query copied from a Czech (or Polish, Slovak…) question often matches zero documents. Add a variant built from word stems with a trailing `*` in code, relax the query before giving up, and never present a "newest documents" listing as the sources of a specific answer.
>
> **Ve zkratce.** SharePoint Search spojuje slova přes AND a české tvary neskloňuje, takže dotaz složený ze slov otázky často nenajde nic. Do každé sady dotazů přidej v kódu variantu z kmenů s `*`, nulu nejdřív zkus uvolnit a výpis „nejnovějších dokumentů“ nikdy nevydávej za zdroje konkrétní odpovědi.

## Symptom

A RAG assistant over SharePoint answers *"I couldn't find a manual for that"*. Under the answer it shows a list of
sources that have nothing to do with the question (a canteen notice, a benefits page, safety data sheets), and a
counter such as *"4 266 documents searched"*. The right document exists, and a person searching by hand finds it.

## Cause

Two things compound:

1. **Implicit AND, and no stemming for inflected forms.** A query such as
   `manuál SAP založení nákupní objednávky` ("manual SAP creation purchase order", with every noun in the genitive)
   requires every term in exactly that form. Measured on a production tenant:

   | Query | Hits | Top results |
   |---|---|---|
   | `manuál SAP založení nákupní objednávky` | 1 | unrelated |
   | same query with a quoted phrase | 0 | – |
   | `manu* SAP založ* nákup* objednávk*` | 55 | the purchase-order guides that were wanted |
   | `schvalovací strop` ("approval ceiling") | 1 | unrelated |
   | `schvalov* (limit* OR strop* OR pravomoc*)` | 178 | the approval-limits directive at position 2 |

   Prefix wildcards (`term*`) are supported in KQL for free-text terms and catch every case ending of the stem.

2. **The zero-hit fallback.** A common pattern is: *if keyword search returns nothing, list the most recently
   modified documents in scope* (`querytext='*'` sorted by `Write`). That is useful for "what's new in the
   library?", but for a specific question it puts random recent documents into the prompt **and into the source
   list**, and the "searched" counter then shows the size of the whole scope.

Asking the model that writes the queries to "include synonyms and free-word variants" is not enough: it often
returns phrases and full inflected words anyway.

## Fix

1. **Add a stem variant in code** to every query set the model generates: lowercase, strip punctuation and
   stopwords, cut words longer than about five characters down to a stem and append `*`, then join the stems with
   spaces (AND). Keep the model's own variants as well. The stems are a heuristic; over-matching is fine, because
   ranking and the answer step filter the results.
2. **Relax before you give up:** model queries → stem variant (AND) → stem variant joined with `OR` → only then
   "nothing found".
3. **Zero hits for a specific question means "nothing found", not "show the latest".** Keep the date-sorted listing
   for genuine corpus questions ("what's new", "what documents do we have about…"). Report a "documents searched"
   number only for real keyword matches.
4. **Add domain synonyms** where people use a different word than the documents do (ceiling ↔ limit ↔ authority).
   A short, maintained list beats hoping the model guesses it.

## Gotchas

- Wrap each generated query in parentheses before you append scope filters (`Path:"…"`, `IsDocument:1`): AND
  binds tighter than OR, so `a OR b Path:"x"` leaks branch `a` out of scope.
- A wildcard right after a very short stem (`ob*`) matches half the index. Keep at least four or five characters
  before the `*`.
- Evaluate on real user conversations, not on demo content. On demo data, titles tend to match the test questions
  word for word, and neither failure shows up.

## Related

- [Graph Search returns 0 hits — you passed the user's question as the queryString](graph-search-raw-question-returns-nothing.md)
