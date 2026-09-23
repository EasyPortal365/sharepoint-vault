---
title: A GitHub Pages CDN without .nojekyll freezes on its last good build
tags: [tooling, github-pages, cdn, jekyll, deployment]
applies-to: GitHub Pages sites published from a branch (static bundle hosts)
last-reviewed: 2026-09-24
---

# A GitHub Pages CDN without `.nojekyll` freezes on its last good build

> **Bottom line.** A site published from a branch goes through Jekyll unless the root of its publishing source contains an empty `.nojekyll` file. For a plain static host of JavaScript bundles that is pure overhead — and as the repository grew, the build started failing with a bare "Page build failed.". The live site kept serving the last successful build, so new files 404ed for everyone who published that day. Add `.nojekyll` when you create the host, and read the build status from the API before you push anything else.
>
> **Ve zkratce.** Web publikovaný z větve prochází Jekyllem, pokud v kořeni publikovaného zdroje neleží prázdný soubor `.nojekyll`. U čistého statického hostingu JavaScriptových bundlů je to zbytečná práce – a s růstem repozitáře začal build padat s holou hláškou „Page build failed.“. Živý web dál servíroval poslední úspěšný build, takže nové soubory vracely 404 každému, kdo ten den publikoval. `.nojekyll` přidej hned při založení a než cokoli dalšího pushneš, přečti stav buildu z API.

## Symptom

A publish script commits and pushes new bundles, and `git show HEAD` lists them. The site keeps serving the previous version of the index file you poll, and the new files return 404; the poll for HTTP 200 times out. Anyone else publishing to the same host that day sees exactly the same thing and has no idea why.

## Cause

The Pages build history shows it at once:

```http
GET /repos/{owner}/{repo}/pages/builds?per_page=10
```

```json
{ "status": "errored", "error": { "message": "Page build failed." }, "duration": 0 }
```

No detail — and every build since one particular commit errored, whoever pushed it. The repository was a pure static bundle host (no `_config.yml`, no layouts, no Gemfile), but without `.nojekyll` GitHub Pages ran Jekyll over it on every build. At about 490 MB and 1,100 files that stopped working.

## Fix

Commit an empty `.nojekyll` to the root of the publishing source. GitHub Pages then publishes the files as they are: in our case the next build passed in 48 seconds and the site caught up with every missed release at once.

## Notes

- **Read the build status before you push an empty commit "to kick it".** `…/pages/builds/latest` tells you `built`, `building` or `errored`; a blind retry of an errored build fails the same way.
- **On a shared host, check the other publishers too.** A frozen site stalls everyone who publishes to it, not only the person who noticed.
- **Without `.nojekyll`, files and folders whose names start with `_` are not published at all** — Jekyll treats them as special.
- **An allowlist `.gitignore` swallows the fix.** If the host repository ignores `*` and whitelists `!*.js`, any new file type — `.nojekyll`, `.json`, images — never reaches the remote. Add the exception first, then check that the pushed commit lists every new file (`git show --stat`).
- A published Pages site may not exceed 1 GB, and a bundle host fills up. Before you prune, read [A retention window computed from git history deletes the file you overwrite in place](retention-by-git-history-deletes-files-overwritten-in-place.md).

## References

- [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site) — the empty `.nojekyll` in the root of the publishing source
- [Bypassing Jekyll on GitHub Pages (GitHub blog)](https://github.blog/news-insights/bypassing-jekyll-on-github-pages/)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [REST API endpoints for GitHub Pages — builds](https://docs.github.com/en/rest/pages/pages)
