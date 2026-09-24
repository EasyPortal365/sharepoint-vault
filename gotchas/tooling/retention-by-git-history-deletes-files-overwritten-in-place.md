---
title: A retention window computed from git history deletes the file you overwrite in place
summary: A stable loader keeps its add date and drifts out of "the last N releases"; protect by shape (no content hash), and remember the hard 1 GB Pages limit counts the published tree
tags: [tooling, git, cdn, github-pages, retention, deployment]
applies-to: Static hosts published from a git repository (GitHub Pages and similar)
last-reviewed: 2026-09-24
---

# A retention window computed from git history deletes the file you overwrite in place

> **Bottom line.** A prune that keeps "everything reachable from the last N releases" can easily date each file by the commit that *added* it — ours did. A file with a stable name that releases overwrite in place — a loader, a shell, an entry point that consumers reference by name — keeps its original add date, drifts out of the window as hashed files pile up around it, and gets deleted: every consumer breaks at once, with nothing changed on their side. Protect such files by their shape (no content hash), never by their position in time.
>
> **Ve zkratce.** Prořez, který drží „vše dosažitelné z posledních N vydání“, snadno datuje soubory podle commitu, který je *přidal* – ten náš to tak dělal. Soubor se stabilním jménem, který vydání přepisují na místě – loader, shell, vstupní bod, na který spotřebitelé odkazují jménem –, si drží původní datum přidání, s přibývajícími hashovanými soubory z okna vyklouzne a smaže se: všem spotřebitelům se to rozbije naráz, aniž se u nich cokoli změnilo. Takové soubory chraň podle tvaru (bez content hashe), nikdy podle pozice v čase.

## Symptom

A routine prune plan lists 75 old files to delete. Before running it you ask the one question the tool never asked: *is anything in this list a file other people load by name?* Nothing in the plan was — but the stable loader sat inside the retention window at position 10 of 10. One more release and it would have been.

## Cause

```bash
git log --diff-filter=A --format=%ct -- app/app-loader.js   # the commit that ADDED the file
```

An overwrite is a modification, not an addition, so the loader's "age" stays frozen at its first release while new releases keep adding fresh hashed files after it. Once more than N newer releases exist, it falls out of the window. The tool's own safety check — "is anything deleted still referenced by something kept?" — cannot catch it, because the reference lives outside the repository: in whatever pins the stable name (an installed package, an embed snippet on other people's pages).

## Fix

```js
// A root file without a content hash is a contract with the outside world: always keep it.
const isStableRoot = (f) => !/_[0-9a-f]{20}\.js$/.test(f);
const queue = roots.filter((f) => isStableRoot(f) || keepCommits.has(addCommitOf(f)));
```

- Derive the protection from the **shape** of the file, not from a per-project "protect" flag that somebody has to remember at exactly the wrong moment.
- **Prove the fix with a parameter where old and new code must disagree.** With a window of 10, both versions produced the same plan — the loader happened to be inside — which looks like "the fix does nothing". With a window of 1 the old code kept one file and the new one kept two; the second was the loader.
- Before any bulk delete on a shared host, write down what is irreplaceable and check that none of it is in the plan.

## Notes

- **GitHub Pages' hard 1 GB limit applies to the published site; for the source repository GitHub only recommends staying under 1 GB.** An ordinary `git rm` commit therefore frees the space that counts, and anything removed can be restored from history (`git checkout <deleting-commit>^ -- <path>`) — no history rewrite needed. Measure the published size from the tree (`git ls-tree -r -l HEAD`), not from the working copy, where untracked leftovers inflate it ([`git rm -r` leaves the directory](git-rm-leaves-the-directory-so-tools-report-a-phantom-version.md)).
- **When the host overflows, the live site keeps serving its last successful build.** Nothing looks broken — new content simply stops arriving, for everyone who publishes there.
- **Sort version folders numerically:** `1.9.0.10` is newer than `1.9.0.9`, but sorts before it as text.
- **`git rm` with a single untracked path aborts the whole batch** (`fatal: pathspec … did not match any files`). Filter through `git ls-files -- <path>` first, or add `--ignore-unmatch`.
- Hashed extension bundles referenced by an installed package are the same kind of contract: [CDN pruning deleted the extension bundle the .sppkg still referenced](../spfx/cdn-pruning-deletes-extension-bundles-the-sppkg-still-references.md).
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
