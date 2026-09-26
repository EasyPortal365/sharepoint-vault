---
title: "A deleted or moved test keeps running from stale `lib-commonjs` — the SPFx rig's `--clean` never touches that folder"
short-title: "`heft --clean` leaves stale tests in `lib-commonjs`"
summary: "In SPFx projects built with Heft, Jest runs the compiled tests in `lib-commonjs`, but the rig's clean step deletes `dist`, `lib`, `release`, generated `.scss.ts`/`.resx.ts` files and parts of `temp` (and `jest-output` for the test phase) — never `lib-commonjs`. Delete, move or rename a test in `src` and its old compiled copy stays there and keeps running, even in `heft test --clean --production`. Delete `lib-commonjs` after moving or deleting files"
tags: [spfx, heft, jest, testing, build]
applies-to: SPFx solutions on the Heft-based toolchain (`@microsoft/spfx-web-build-rig`, seen with SPFx 1.22) whose Jest configuration runs tests from `lib-commonjs`
last-reviewed: 2026-09-26
---

# A deleted or moved test keeps running from stale `lib-commonjs` — the SPFx rig's `--clean` never touches that folder

> **Bottom line.** Jest in an SPFx project runs the compiled tests in `lib-commonjs`, and nothing in the build ever deletes that folder. When you delete, move or rename a test (or the module it imports) in `src`, the old compiled copy stays behind and keeps running — even with `heft test --clean` or in the production build. After moving or deleting files, delete `lib-commonjs` before the next test run.
>
> **Ve zkratce.** Jest v SPFx projektu spouští zkompilované testy z `lib-commonjs` a tuhle složku build nikdy nemaže. Když ve `src` test (nebo modul, který importuje) smažeš, přesuneš nebo přejmenuješ, stará zkompilovaná kopie zůstane a běží dál – i s `heft test --clean` a v produkčním buildu. Po přesunu nebo smazání souborů smaž před dalším během testů `lib-commonjs`.

## Symptom

You move `recordParts.ts` and `recordParts.test.ts` from one folder to another (or delete a test file). The next `heft test --clean` still reports the test from its old location, or reports it twice. The test count in the log is higher than the number of tests you can find in the source tree.

A second, quieter variant: you deliberately break the code to prove a test catches it (a "sabotage" check), and the log still shows that test passing — it is the stale copy compiled from the old location, which never sees your change.

## Cause

The SPFx build rig defines what `--clean` deletes in `node_modules/@microsoft/spfx-web-build-rig/profiles/default/config/heft.json`:

```jsonc
// build phase
"cleanFiles": [
  { "sourcePath": "src", "fileExtensions": [".resx.ts", ".scss.ts", ".resx.d.ts", ".scss.d.ts"] },
  { "includeGlobs": ["dist", "lib", "release"] },
  { "sourcePath": "temp", "includeGlobs": ["generated-code", "loc-ts", "sass-ts", "static-asset-ts", "*.json", "*.md"] }
]
// test phase
"cleanFiles": [{ "sourcePath": "jest-output" }]
```

`lib-commonjs` is not on either list. The TypeScript compiler writes into it only the files that exist in `src` and never removes output whose source is gone, while the rig's Jest configuration (`roots` and `testMatch` point at `lib-commonjs`) picks up every `*.test.js` it finds there.

## Fix

After deleting, moving or renaming source files — tests in particular — delete the folder before the next test run or production build:

```powershell
Remove-Item .\lib-commonjs -Recurse -Force
npx heft test --clean   # or your production build script
```

Then compare the test count in the log with what you expect. An unexpected increase, or a test from a path that no longer exists in `src`, is this trap.

## Notes

- A sabotage check on a moved test proves something only after the cleanup; before it, the stale copy can pass.
- The manual deletion above is what we verified. Adding `lib-commonjs` to the clean list in the project's own Heft configuration, or deleting it in a pre-test script, should make it permanent, but we have not tested either — the rig's defaults will not do it for you.
