---
title: `git rm -r` leaves the directory behind, so a tool reading the filesystem reports a version nobody serves
tags: [tooling, git, github-pages, cdn, release]
applies-to: any git-backed static host (GitHub Pages) with per-version folders
last-reviewed: 2026-09-06
---

# `git rm -r` leaves the directory behind, so a tool reading the filesystem reports a version nobody serves

> **Bottom line.** `git rm -r <dir>` deletes only *tracked* files; build leftovers that were never added (`*.LICENSE.txt`, `.map`, logs) keep the directory alive on disk. Anything that lists versions with `readdirSync` then offers a version the site does not serve — in our case a pin tool that would have pinned our tenant to a build that had just been removed. For a git-backed host, the published content is `git ls-tree`, never the working directory.
>
> **Ve zkratce.** `git rm -r <adresář>` smaže jen *sledované* soubory; nesledované zbytky po buildu (`*.LICENSE.txt`, `.map`, logy) nechají adresář na disku stát. Nástroj, který verze vypisuje přes `readdirSync`, pak nabídne verzi, kterou web neservíruje – u nás by nástroj na piny připnul tenant na build, který jsme právě odstranili. U hostingu nad gitem je publikovaný obsah `git ls-tree`, nikdy pracovní adresář.

## Symptom

You remove a version folder from the repo that backs the static host:

```bash
git rm -r cdn/app/1.52.0.1
git commit -m "remove superseded silent build" && git push
```

The site returns 404 for it, as intended. But your own tooling keeps naming it:

```text
"app":"1.52.0.1"        # generator picking the newest version folder
```

`ls` explains it:

```bash
$ ls cdn/app/1.52.0.1
chunk.165_....js.LICENSE.txt
chunk.8731_....js.LICENSE.txt
...
```

Seven files that were never tracked (a `.gitignore` entry, or simply never added). `git rm` had nothing to say about them, so the directory survived — empty as far as the site is concerned, present as far as the filesystem is concerned.

## Why it matters more than it looks

The mismatch is silent and it points the wrong way: the tool advertises **more** than exists. Ours picks "the highest version folder" as the pin target, so it was about to pin our own tenant to a build that had ceased to exist — we would have been testing something the CDN could no longer serve, while customers ran the real one.

The same shape bites size accounting: `du -sh` over the working directory counts untracked leftovers that never reach the host, so a repo that looks close to a hosting quota may be far from it (and vice versa).

## Fix

**Read the published content from git, not from disk.**

```js
const { execFileSync } = require('child_process');

function publishedVersions(repoDir, appFolder) {
  const out = execFileSync('git', ['-C', repoDir, 'ls-tree', '--name-only', '-d', 'HEAD:' + appFolder], { encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(s => /^\d+(\.\d+){1,3}$/.test(s));
}
```

Two details worth keeping:

- **Fail closed.** If `git` cannot be read, exit with an error instead of falling back to `readdirSync` — a tool that silently degrades to the wrong source is how the bug returns.
- **Compare versions numerically, per component.** `1.10.0` is newer than `1.9.9`; lexicographic sorting says the opposite.

And when you do remove a folder, clean the working copy too (`rm -rf` after the `git rm`), so the two views stop disagreeing at all.

## Related

- [Compiled files next to sources fake your build check](compiled-files-next-to-sources-fake-your-build-check.md) — another case of the filesystem answering a question about what actually ships
