---
title: Git Bash on Windows mangles backslashes passed to native tools — regexes silently stop matching
tags: [tooling, windows, git-bash, ripgrep]
applies-to: Git Bash / MSYS2 on Windows
last-reviewed: 2026-07-16
---

# Git Bash on Windows mangles backslashes passed to native tools — regexes silently stop matching

## Symptom

From Git Bash you run a native Windows tool (ripgrep, findstr, anything not MSYS-built) with a regex that handles both path separators:

```bash
rg 'kamil\.jurik[\\/]Documents' --files-with-matches
```

It returns a handful of hits — all of them forward-slash occurrences. The backslash-path occurrences (the majority on Windows) are **silently missing**, and the incomplete result looks perfectly plausible.

## Cause

The MSYS layer between Bash and a **native** executable post-processes arguments (path conversion and backslash handling). Your `[\\/]` arrives at the tool as `[/]`. Single-quoting in Bash doesn't protect you — the mangling happens *after* the shell, on the way into the native process.

The nastiest property: no error, no warning — just fewer matches, which in a migration or audit reads as "these files don't exist".

## Fix

Pick any of the three, in order of preference:

1. **Don't write `\\` at all** — match the separator with a class that survives the trip: `.{1,4}` or `.` (covers `\`, `\\` *and* `/`):

   ```bash
   rg 'kamil\.jurik.{1,4}Documents' --files-with-matches
   ```

2. **Verify with a counter-example** — whenever a search over Windows paths returns suspiciously few results, re-run a shorter pattern against one file where the match *provably* exists (`rg -c 'jurik' that-file`). One command distinguishes "no matches" from "mangled pattern".
3. **Run the native tool from PowerShell instead** — no MSYS layer, `[\\/]` works as written.

## Notes

- The same mechanism is behind MSYS's famous *path conversion* (arguments that look like `/foo` becoming `C:\msys64\foo`) — `MSYS_NO_PATHCONV=1` helps for paths, but the backslash handling in regex arguments is the sneakier sibling.
- Treat *any* "grep found surprisingly little" moment on Windows as a tooling suspect first, filesystem fact second.
