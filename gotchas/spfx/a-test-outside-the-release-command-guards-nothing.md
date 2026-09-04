---
title: A test that runs under a different command than your release guards nothing
tags: [spfx, heft, build, testing]
applies-to: SharePoint Framework (Heft)
last-reviewed: 2026-09-04
---

# `heft test` is not on the path your package takes

> **Bottom line.** In a Heft-based SPFx project, `npm run build` and the command you actually ship with are usually not the same script — and unit tests run under only one of them. A check that lives in `heft test` never executes during `heft build`, so on the path your `.sppkg` really travels, it guards nothing.
>
> **Ve zkratce.** V SPFx projektu na Heftu se vydává jiným příkazem, než kterým se testuje. Kontrola pověšená na `heft test` se při `heft build` nespustí — na cestě, po které balíček odchází k zákazníkovi, tedy nehlídá nic.

## Symptom

You go looking for coverage of some rule — a permission policy, a required manifest field, a security invariant — and you find a test file with exactly the right name. The area looks covered, so you move on.

It is not covered. The test has never run in a release, and if the rule breaks, nothing stops the package from being built and uploaded.

## Cause

Heft splits work across separate actions, and project scripts tend to grow into two families that drift apart:

```jsonc
{
  "scripts": {
    "build":         "heft test --clean",           // tests run here
    "build:ship":    "npm run prebuild:ship && heft build --clean --production",
    "prebuild":      "npm run check:a && npm run check:b",
    "prebuild:ship": "npm run check:a"              // ← check:b missing
  }
}
```

Two independent gaps open up:

1. **`heft build` does not run Jest.** Anything asserted in a `*.test.ts` is simply absent from the release build. That is by design — tests are a development action — but it means a test is documentation of intent, not a release gate.
2. **The two prebuild scripts drift.** A guard added to `prebuild` while working locally is easy to forget in `prebuild:ship`, and nothing complains: both scripts are valid, both pass, and the difference shows only as an absence.

Neither gap is visible from the test file, and neither shows up in code review of the rule itself. You have to read `package.json` and ask which script the release uses.

## What to do

- **Ask two questions of every guard.** *Which command actually ships the package, and is the guard in it?* Not "is it in some npm script" — in **that** one. And: *how much of the protected set does it measure?* A guard covering one of seven objects is a sample, not a guarantee.
- **Put release-blocking rules in a plain Node script**, not in Jest. A `scripts/check-*.js` invoked from both `prebuild` and `prebuild:ship` runs everywhere and needs no test runner. Keep Jest for behaviour you want fast feedback on while developing.
- **Make the two prebuilds impossible to drift.** Either `prebuild:ship` calls `prebuild` and adds to it, or a tiny check asserts the guard list is identical. Copies of a list in two places is the same problem in miniature.
- **Prove it by removing the rule.** Delete the load-bearing line, run the *release* command, and confirm it fails. If it still succeeds, the guard is not where you think it is. This is the only check that distinguishes "we have a test" from "we are protected".

## Notes

- The same shape appears outside Heft: a lint rule enabled only in the editor, a pre-commit hook contributors can skip, a CI job that runs on pull requests but not on the branch you release from.
- Worth auditing after any refactor that splits or renames build scripts — that is when the two families most often diverge.
- If a rule genuinely belongs in tests (it needs mocks, a DOM, async behaviour), then say so where someone will look, and add a cheap static guard alongside it for the release path.
