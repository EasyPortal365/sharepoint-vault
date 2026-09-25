---
title: A test that plants a git hook passes on Windows and fails on Linux CI
short-title: A planted git hook runs on Windows and is skipped on Linux
summary: "Git ignores a hook without the executable bit, but Git for Windows runs any hook that starts with a shebang, so a fixture that writes `.git/hooks/pre-commit` with `writeFileSync` blocks the commit locally and not in CI; `chmod 0o755` after writing (harmless on Windows), and commit hook scripts with `git add --chmod=+x`"
tags: [tooling, git, ci, windows, linux, testing]
applies-to: Git hooks written by tests or scripts on Windows (Git for Windows, `core.fileMode=false`) and run on Linux CI runners (seen with Git for Windows 2.54 and GitHub Actions `ubuntu-24.04`)
last-reviewed: 2026-09-25
---

# A test that plants a git hook passes on Windows and fails on Linux CI

> **Bottom line.** Git runs a hook only when the file has the executable bit. Windows has no such bit, so Git for Windows runs a hook that starts with `#!/bin/sh` as soon as the file exists, and a test fixture that just writes the hook passes locally. On Linux the same hook is skipped and the commit goes through. Call `chmod 0o755` on every hook a test or script writes, and set the bit in the index for hook scripts you commit from Windows.
>
> **Ve zkratce.** Git spustí hook jen se spustitelným bitem. Windows žádný takový bit nemají, takže Git for Windows spustí hook začínající `#!/bin/sh`, jakmile soubor existuje – test, který hook jen zapíše, lokálně projde. Na Linuxu se tentýž hook přeskočí a commit projde. Každý hook, který test nebo skript zapisuje, označ `chmod 0o755`; u hooků, které commituješ z Windows, nastav bit v indexu.

## Symptom

A test suite for a publish script checks that a failing pre-commit hook stops the publish. It writes `.git/hooks/pre-commit` into a scratch repository, runs the publish and expects exit code 1 and nothing pushed:

```js
fs.writeFileSync(path.join(repo, '.git/hooks/pre-commit'), '#!/bin/sh\necho hook rejects\nexit 1\n');
const r = await publish(repo);
assert.equal(r.code, 1);
```

On Windows the test passes. In CI on `ubuntu-24.04` it fails every time: the commit succeeds, the publish exits 0 and the remote moves (messages translated):

```text
FAIL  hook: exit 1 (expected 1, got 0)
FAIL  hook: message
FAIL  hook: nothing pushed (expected "3b1cde7…", got "3fe887c…")
```

The code under test is fine. On Linux the scratch repository simply has no hook that git will run.

## Cause

- The Git documentation for hooks says it plainly: hooks that don't have the executable bit set are ignored. `fs.writeFileSync` does not set that bit, so on Linux git skips the hook. At most it prints a hint to stderr (controlled by `advice.ignoredHook`), which a script that captures git's output never shows.
- Windows has no executable bit. Git for Windows 2.54 ran the same `#!/bin/sh` hook without any `chmod`, so the local run blocked the commit as the test expected.
- The same trap applies to hook scripts you commit. With `core.fileMode=false` (the Windows default), a new file is added with mode `100644` even when it starts with a shebang. A Linux clone then gets a hook git ignores.

## Fix

Set the bit right after writing the hook:

```js
const hook = path.join(repo, '.git', 'hooks', 'pre-commit');
fs.writeFileSync(hook, '#!/bin/sh\necho hook rejects\nexit 1\n');
fs.chmodSync(hook, 0o755);   // Linux/macOS: required, or git skips the hook. Windows: no effect
```

- On Windows, Node's `chmod` can only change the write permission, so `0o755` changes nothing there. The same line works on both systems.
- Keep the shebang. Without it, Git for Windows 2.54 did not skip the hook. It failed with `cannot spawn .git/hooks/pre-commit`, with or without `chmod`, and the commit failed for the wrong reason.
- For hook scripts in the repository, for example a folder used through `core.hooksPath`: `git add --chmod=+x <file>` (or `git update-index --chmod=+x <file>` for an already tracked file), then check that `git ls-files -s <file>` shows `100755`.

## Notes

- Anything that depends on file modes (hooks, shell scripts started directly, files a script marks executable) can pass locally on Windows and fail on a Linux runner. A green local run of such a test says nothing about CI.
- The fixture was the bug, not the code: after adding `chmod`, the same test passed on the Linux runner with no other change.

## References

- [Git documentation: githooks](https://git-scm.com/docs/githooks) — "Hooks that don't have the executable bit set are ignored."
- [Git documentation: git-config](https://git-scm.com/docs/git-config) — `advice.ignoredHook`: shown when a hook is ignored because it is not set as executable.
- [Git documentation: git-add](https://git-scm.com/docs/git-add) — `--chmod=(+|-)x` overrides the executable bit of the added files in the index.
- [Node.js documentation: File system](https://nodejs.org/api/fs.html) — File modes caveat: on Windows only the write permission can be changed.
