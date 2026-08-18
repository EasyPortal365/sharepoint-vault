---
title: An unparenthesized OR in your KQL query silently escapes the scope filter
tags: [search, kql, rag, security, scope]
applies-to: SharePoint Search REST (/_api/search/query), Query API, KQL
last-reviewed: 2026-08-18
---

# An unparenthesized `OR` in your KQL query silently escapes the scope filter

> **Bottom line.** In KQL `AND` binds tighter than `OR`, so an unparenthesized user query lets its first `OR` branch escape the scope filter you appended — wrap the whole user/AI query in parentheses before adding `Path:` and `IsDocument:1`.
>
> **Ve zkratce.** V KQL váže `AND` silněji než `OR`, takže neuzávorkovaný dotaz uživatele nechá svou první větev `OR` uniknout z přidaného scope filtru – celý dotaz uživatele/AI obal závorkami dřív, než přidáš `Path:` a `IsDocument:1`.

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

## Parenthesizing is necessary but NOT sufficient

Wrapping the query fixes precedence. It does **not** stop the query text from breaking *out of*
the parentheses you just added. Given `foo) OR (bar`, your template produces:

```
(foo) OR (bar) Path:"…" IsDocument:1
```

and the `foo` branch again has neither the path filter nor `IsDocument`. An odd number of `"`
does the same thing through an unterminated phrase.

This matters because the query text is often **not** typed by a human: assistants generate
synonym variants with `OR` and quoted phrases, and fallback paths tend to push the raw user
question straight into KQL.

Balance the structural characters before assembling. Do **not** escape everything — quoted
phrases and groups improve recall; drop only what breaks structure (surplus `)`, unclosed `(`,
a trailing odd `"`):

```js
function balanceKql(queryText) {
  const s = String(queryText || '');
  let depth = 0; const keep = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '(') { depth++; keep.push(ch); continue; }
    if (ch === ')') { if (depth === 0) continue; depth--; keep.push(ch); continue; }
    keep.push(ch);
  }
  let out = keep.join('');
  while (depth > 0) { out += ')'; depth--; }          // close from the right; deleting inner "(" would change grouping
  if ((out.split('"').length - 1) % 2 === 1) {        // odd quote count → drop the last one
    const last = out.lastIndexOf('"');
    out = out.substring(0, last) + out.substring(last + 1);
  }
  return out.trim();
}
```

`foo) OR (bar` → `foo OR (bar)`; `(a OR b)` and `"exact phrase"` pass through untouched.

## An empty custom path list must not mean "everywhere"

Related failure in the same function, and arguably worse because nothing looks wrong:

```js
if (scope === 'custom') {
  const paths = (customPaths || '').split('\n').map(p => p.trim()).filter(Boolean);
  if (paths.length === 0) return '';   // ← no Path: filter at all = the whole tenant
  …
}
```

An admin who selected "search only these locations" and left the box empty (or emptied it later)
gets the exact opposite of the setting. **A restriction that falls back to the full set when its
input is empty is not a restriction.** Fail closed — the tightest safe reading of "custom scope,
but you listed nothing" is the current site, never a widening:

```js
if (paths.length === 0) return prefix(webUrl);
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
