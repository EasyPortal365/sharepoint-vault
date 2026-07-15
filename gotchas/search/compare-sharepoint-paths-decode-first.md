---
title: Comparing SharePoint URLs — decode both sides first, then prefix-match on boundaries
tags: [search, urls, encoding]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-07-16
---

# Comparing SharePoint URLs: decode both sides first, then prefix-match on boundaries

## Symptom

You match search results (or list items) against configured site/library URLs — "is this document under one of the allowed paths?" — and the match **never fires**, even though the paths are visibly identical on screen.

## Cause

The two strings come from different worlds:

- a URL copied from the **browser** carries percent-encoding: `/sites/HR/Shared%20Documents`,
- the search **`Path`** property (and most REST-returned URLs) comes back **decoded**: `/sites/HR/Shared Documents`.

Raw `startsWith` between those two never matches. And once you "fix" it with naive prefixing, a subtler bug appears: `/sites/hr` happily prefix-matches `/sites/hr2`.

## Fix

Normalize both sides, then compare with a **boundary-aware** prefix:

```ts
const norm = (u: string): string => {
  let s = u;
  try { s = decodeURIComponent(s); } catch { /* already decoded / stray % */ }
  s = s.toLowerCase();
  return s.replace(/\/+$/, '');
};

const isUnder = (path: string, root: string): boolean => {
  const p = norm(path), a = norm(root);
  return p === a || p.indexOf(a + '/') === 0;   // boundary: '/sites/hr' won't match '/sites/hr2'
};
```

## Notes

- The `try/catch` around `decodeURIComponent` matters — a stray `%` in an already-decoded string throws.
- Reflex worth adopting: whenever "SharePoint paths don't match", **print both raw strings side by side first** — the encoding difference is visible instantly and saves an hour of debugging match logic.
- Unit-test the comparator with real values from *both* sources (a browser-copied URL and a search `Path`), not with hand-typed strings — hand-typed test data is always conveniently pre-normalized.
