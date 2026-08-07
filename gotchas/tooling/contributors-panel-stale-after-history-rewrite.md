---
title: "The Contributors panel keeps a co-author you removed from history"
tags: [tooling, git, github]
applies-to: GitHub (repository Contributors panel)
last-reviewed: 2026-08-07
---

# The Contributors panel keeps a co-author you removed from history

> **Bottom line.** After rewriting history to drop `Co-Authored-By` trailers, the repository's Contributors panel can keep listing the removed person indefinitely — and the REST `/contributors` endpoint cannot confirm the removal for you, because it never counted co-authors in the first place.
>
> **Ve zkratce.** Když přepíšeš historii, abys odstranil `Co-Authored-By` trailery, může postranní panel Contributors odstraněnou osobu vypisovat dál libovolně dlouho – a REST endpoint `/contributors` ti odstranění nepotvrdí, protože co-autory nikdy nepočítal.

## Symptom

You rewrite history to remove `Co-Authored-By:` trailers, force-push, and verify the result:

```bash
git log origin/main --format='%B' | grep -ci 'co-authored-by'
# 0
```

The trailer is gone from every commit on the default branch. The Contributors panel on the repository page still shows the person, day after day, across dozens of pushes.

Worse, your verification can point the wrong way. Querying the API looks like confirmation:

```bash
curl -s .../repos/{owner}/{repo}/contributors | jq '.[].login'
# "octocat"        <- only one contributor, looks clean
```

…while the panel next to the README says `Contributors 2`.

## Cause

Two separate things, and both matter.

**1. The panel and the API do not count the same thing.** `GET /repos/{owner}/{repo}/contributors` counts commit **authors**. The Contributors panel additionally credits **co-authors** from commit trailers. So before the rewrite the API never showed the co-author either — which means a "clean" API response proves nothing about whether your rewrite worked. It is not a verification, it is a different question.

**2. The panel's data is cached and refreshed on its own schedule.** GitHub documents that after force-pushing, rewriting history, or deleting commits, contributor displays and statistics can take **about 24 hours** to refresh. The API side updates promptly — its contribution count climbs with every push — while the panel does not move.

That split is the diagnostic: an API that tracks new commits alongside a panel frozen on an old figure means the data is fine and the presentation is stale.

## Fix

**Verify at the source, not through the API.** Only the repository itself can tell you whether the trailers are gone:

```bash
git fetch origin main
git log origin/main --format='%B' | grep -ci 'co-authored-by'   # must be 0
git log origin/main --format='%an <%ae>' | sort -u              # expected authors only
```

**Then give it the documented window.** Roughly 24 hours after the force-push, with pushes happening in between.

**If the panel is still wrong after that, open a support ticket** — this is the documented escalation, not a workaround. Lead with the contradiction, because it is what distinguishes a caching bug from your own mistake:

> After rewriting history on `<date>` to remove `Co-Authored-By` trailers, no commit on the default branch contains the trailer, and `GET /repos/{owner}/{repo}/contributors` returns a single contributor with an up-to-date count. The Contributors panel still lists a user who appears in no commit, more than 24 hours and many pushes later. Please trigger a recalculation.

## Notes

- **Check the documented refresh window before you start waiting.** Without it there is no threshold that tells you "this is now abnormal", and the wait quietly stretches to a week. Knowing the number turns waiting into a decision.
- A force-push does not immediately destroy the old commits server-side; they stay reachable by SHA for a while. If you also prune your local backups and reflog, you lose the ability to test whether anything still references them — worth keeping until the display is confirmed clean.
- The **Insights → Contributors** graph is a third surface with its own rules: it only shows the top 100 contributors, so on a busy repository an absent name there may mean something else entirely.
- Avoiding the problem is cheaper than fixing it: if trailers are unwanted, strip them at commit time (a `commit-msg` hook) rather than rewriting history later.
- The general shape — two endpoints that look interchangeable but answer different questions — also shows up in [a page-size cap reported as a finding](../rest-api/page-size-cap-reported-as-a-result.md).
