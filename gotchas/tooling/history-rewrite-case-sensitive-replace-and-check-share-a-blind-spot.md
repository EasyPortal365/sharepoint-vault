---
title: Rewriting git history to remove sensitive values – a case-sensitive replace and a case-sensitive check miss the same forms
summary: "When you scrub values (codes, names) from the whole git history with fast-export/fast-import or filter-repo, an exact-string replace plus a `git log -S` check without `-i` share one blind spot: any casing you did not list stays, and the check reports 0. Replace and verify case-insensitively, match short codes as whole words so common words and HEAD stay untouched, and make the check broader than the fix"
tags: [git, history-rewrite, fast-export, filter-repo, pickaxe, data-hygiene, tooling]
applies-to: Any git repository (including SPFx solution repos) where values must be removed from every commit, not only from HEAD
last-reviewed: 2026-11-23
---

# Rewriting git history to remove sensitive values – a case-sensitive replace and a case-sensitive check miss the same forms

> **Bottom line.** You rewrite the whole history to remove a set of values, then verify with `git log -p --all -S"<value>"` for every value and get 0. A lower-case form you did not list is still there, because the replace (exact string match) and the check (`-S` is case-sensitive) are blind in exactly the same way. Replace and verify **case-insensitively**, treat short codes as **whole words** (otherwise `-i` hits ordinary words and changes your HEAD tree), and make the verification broader than the replacement.
>
> **Ve zkratce.** Přepíšeš celou historii, aby z ní zmizely určité hodnoty, a ověříš to `git log -p --all -S"<hodnota>"` pro každou z nich: všude 0. Tvar malými písmeny, který jsi nevyjmenoval, tam přesto zůstal, protože náhrada (přesná shoda řetězce) i kontrola (`-S` rozlišuje velikost písmen) jsou slepé úplně stejně. Nahrazuj i ověřuj **bez ohledu na velikost písmen**, krátké kódy ber **jako celé slovo** (jinak `-i` zasáhne běžná slova a změní strom HEAD) a kontrolu udělej širší než opravu.

## Symptom

- After a full-history rewrite and force push, your verification script prints 0 for every value and you report the history as clean.
- Someone later finds one of the values in an old commit, typed in lower case in a test string (`'north abc'` where you replaced `ABC`).
- Fixing it means a second rewrite and a second force push – and every commit hash quoted in your notes changes again.

## Cause

- The replace step searched exact strings (`Buffer.indexOf`, `sed s/ABC/XY/`, a `--replace-text` file with literal entries). Variants of case were listed by hand, and one was missing.
- `git log -S<string>` is case-sensitive by default. It counts occurrences of exactly the strings you give it – the same list the replace used. A form missing from the list is invisible to both.
- Adding `-i` naively does not help with short codes: a three-letter code as a case-insensitive substring also matches `mood`, `month`, base64 and hashes in lock files. Replacing those would change the tree of HEAD, which you normally must keep byte-identical.

## Fix

1. **Inventory first, with the same query you will verify with.** For each value:
   - short codes (2–4 letters): whole word, case-insensitive –
     `git log --all -i --pickaxe-regex -S'(^|[^A-Za-z0-9_])ABC([^A-Za-z0-9_]|$)'` (add your language's letters to the class);
   - longer values: case-insensitive substring – `git log --all -i -S'Some Name'`;
   - plus `git grep -i -E '<same regex>' HEAD` and `git log --all -i -E --grep='<same regex>'` for commit messages.

   Any hit in HEAD means a rewrite will change your current tree – fix HEAD in a normal commit first.
2. **Replace with a case-insensitive regex**, whole-word for short codes, and keep the shape of the match (lower case in → lower-case replacement out). Skip blobs with NUL bytes, and only *check* blobs that are not valid UTF-8 (decode as latin1) instead of re-encoding them.
3. **Verify** after the import with the step 1 queries across all refs, and check that `git rev-parse HEAD^{tree}` is the same before and after.
4. Then push with `--force-with-lease=<branch>:<old-hash>`, expire the reflog, and run `git gc --prune=now`. The hosting provider may still serve old commits by their hash (on GitHub, removing cached views and unreachable commits goes through GitHub Support).

```js
// fast-export stream filter: case-insensitive, whole word for short codes
const L = 'A-Za-z0-9_';
const rules = [['ABC', 'XY'], ['Some Name', 'Neutral Name']].map(([a, b]) => ({
  re: /^[A-Z]{2,4}$/.test(a)
    ? new RegExp('(^|[^' + L + '])(' + a + ')(?=[^' + L + ']|$)', 'gi')
    : new RegExp('()(' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
  b
}));
const shape = (m, b) => (m === m.toLowerCase() && m !== m.toUpperCase() ? b.toLowerCase() : b);
const scrub = s => rules.reduce((t, { re, b }) => t.replace(re, (_, pre, m) => pre + shape(m, b)), s);
```

## Rule of thumb

A verification that uses the same method as the fix verifies nothing. When you remove data, make the check wider than the replacement (case-insensitive, word-based, over all refs and commit messages), and run it *before* the rewrite as an inventory as well as after.
