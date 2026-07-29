---
title: npm audit --omit=dev overstates what SPFx actually ships
tags: [spfx, security, dependencies, build]
applies-to: SharePoint Framework
last-reviewed: 2026-07-29
---

# `npm audit --omit=dev` overstates what SPFx actually ships

> **Bottom line.** SPFx puts its build toolchain in `dependencies`, not `devDependencies`, so `--omit=dev` counts Node-only build packages as "production" — the only reliable test of what reaches a browser is grepping the published bundle.
>
> **Ve zkratce.** SPFx má svůj build toolchain v `dependencies`, ne v `devDependencies`, takže `--omit=dev` počítá Node-only build balíčky jako „produkční" – jediný spolehlivý test toho, co se dostane do prohlížeče, je grep do publikovaného bundlu.

## Symptom

You run a dependency audit across your SPFx solutions and get an alarming number of **high-severity findings in production dependencies** — often the same package in every single web part. It looks like a fleet-wide emergency.

In a real audit of 14 solutions this was **229 "production" findings**, including one HIGH (CVSS 7.5) present in *all* of them.

## Cause

Follow the dependency chain of a typical offender:

```
@microsoft/sp-component-base
  └─ @microsoft/sp-module-interfaces
       └─ @rushstack/node-core-library
            └─ ajv-formats
                 └─ ajv
                      └─ <vulnerable package>
```

`@rushstack/node-core-library` is a **Node.js build-time library**. It reads files from disk and never executes in a browser. But `@microsoft/sp-*` packages legitimately live in `dependencies` (they are runtime API surface), so everything beneath them inherits the "production" label — including the parts that only ever run inside the build.

`npm audit --omit=dev` answers *"which packages are not marked dev?"*. It does not answer *"which code ships to users?"* — and for SPFx those are very different questions.

## Fix: grep the published bundle

The bundle is the ground truth. Ask it directly:

```bash
# in the folder you publish (CDN repo, or dist/ after a production build)
for lib in fast-uri node-core-library ajv-formats some-suspect-package; do
  echo "$lib: $(grep -rl "$lib" --include=*.js . | wc -l) file(s)"
done
```

Real result from the audit above:

```
fast-uri            0 files   <- build-only, never shipped
node-core-library   0 files
ajv-formats         0 files
@xmldom/xmldom      3 files   <- the only genuine finding
react (control)   193 files
```

**Always include a control sample** — something that *must* be there, like `react`. Without it you cannot tell "not present" from "my grep is broken". This is the same discipline as any other negative result.

Of 229 "production" findings, exactly **one package** was actually reachable by a user.

## Notes

- Minifiers rewrite constants, so grep for the **package name string** (which survives in module paths, license banners and error messages), not for a version number or a numeric literal — `600000` may well appear as `6e5`.
- Counts are not comparable across projects unless their `node_modules` are populated the same way. In the same audit, two solutions reported ~3× more findings purely because they had `jest` and `eslint` installed locally and the others did not.
- A scanner that over-reports is as harmful as one that under-reports: at 229 findings nobody triages anything, so the single real issue goes unfixed too. Convert counts into "what actually runs at the customer" before escalating.
