---
title: An unparenthesized OR in your KQL query silently escapes the scope filter
tags: [search, kql, rag, security, scope]
applies-to: SharePoint Search REST (/_api/search/query), Query API, KQL
last-reviewed: 2026-07-18
---

# An unparenthesized `OR` in your KQL query silently escapes the scope filter

## Symptom

You build a search-backed assistant (RAG). An admin confines it to a scope — one site,
a list of paths, or "authoritative sources only" — by appending a `Path:` filter to every
query. It works for single-word queries. Then a user asks something that expands into an
`OR` of synonyms, and results start coming back **from outside the configured scope** —
documents the admin deliberately kept the assistant away from show up in answers and citations.

No error. ACL trimming still holds (nobody sees a file they lack rights to), so it doesn't
look like a security bug — but the *scope confinement* the admin relied on is gone.

## Cause

You assembled the query as string concatenation:

```
${queryText} ${scopeFilter} IsDocument:1
```

`queryText` comes from the user (or, worse, from an LLM instructed to broaden with `OR`), e.g.
`budget OR "annual budget"`. `scopeFilter` is `Path:"https://contoso.sharepoint.com/sites/hr/*"`.
The concatenation becomes:

```
budget OR "annual budget" Path:"…/sites/hr/*" IsDocument:1
```

**In KQL, `AND` binds tighter than `OR`**, and adjacent terms are implicit `AND`. So the engine
reads this as:

```
budget OR ("annual budget" AND Path:"…/sites/hr/*" AND IsDocument:1)
```

The first branch — `budget` — carries **neither the Path filter nor `IsDocument`**. It matches
anything in the tenant the user can read. The scope (and your `IsDocument:1` document filter)
only applies to the second branch. One bare `OR` and the fence is down.

## Fix

Parenthesize the user/AI-supplied query so the scope attaches as a hard `AND` to the whole thing:

```
(${queryText}) ${scopeFilter} IsDocument:1
```

giving `(budget OR "annual budget") AND Path:"…" AND IsDocument:1`. Now every branch is inside
the scope. If you also wrap the base in `XRANK` for ranking boosts, wrap the *already-parenthesized*
base — the boost clause is separate and doesn't change the confinement.

```
(${queryText.trim() ? '(' + queryText.trim() + ')' : ''} ${scopeFilter} IsDocument:1)
```

## Why it's easy to miss

- It only surfaces when the query contains `OR` — single-term queries look perfectly scoped, so it
  passes casual testing.
- It's **not** OData/KQL injection: doubling `'`→`''` in the OData string literal is still correct and
  necessary. This is operator *precedence*, one layer up, and escaping does nothing for it.
- ACL trimming masks it: because users never see files they can't access, the leak reads as
  "search is a bit broad" rather than "scope is bypassed."

## See also

- `gotchas/search/search-api-needs-odata-version-3.md` — the header behind mysterious 500s.
- Same class of "confinement you assumed isn't there": always test scope filters with an `OR` query.
