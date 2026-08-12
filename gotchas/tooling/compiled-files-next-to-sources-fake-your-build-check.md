---
title: Compiled files sitting next to sources fake your build verification
tags: [tooling, typescript, npm, monorepo, build, verification]
applies-to: Any TypeScript/JavaScript package (SPFx shared packages, npm workspaces)
last-reviewed: 2026-08-12
---

# Compiled files sitting next to sources fake your build verification

> **Bottom line.** Stale `.js`/`.d.ts` left inside `src/` grep like live code while nothing loads them. Verify a build by asking what the runtime *resolves* — `node -p "require.resolve('<pkg>')"` — not by reading whichever compiled file your grep happened to hit.
>
> **Ve zkratce.** Zapomenuté `.js`/`.d.ts` v `src/` se grepují jako živý kód, ale nikdo je nenačítá. Build ověřuj tím, co runtime skutečně resolvuje (`require.resolve`), ne obsahem souboru, na který zrovna padl grep.

## Symptom

You fix a bug in a shared package, run the build, and it succeeds — `tsc`, exit 0. Then you grep the compiled output to confirm the change shipped, and it shows the **old** value. It looks like the build silently didn't take, and you start hunting for a broken toolchain, a cache, a wrong `tsconfig`.

## Cause

There were two compiled copies, and grep found the dead one.

The package emitted to `lib/` (`package.json` → `"main": "lib/index.js"`, `tsconfig.json` → `"outDir": "lib"`), but an **older build configuration** had emitted next to the sources, and those files were still on disk — and committed. Frozen at whatever the code looked like on the day the config changed, months earlier.

A particularly good disguise: `lib/` was in `.gitignore`. So the **dead copies were versioned and the live output was not**, which makes the stale files look more authoritative than the real ones in every code-review and file listing.

## Fix

Ask the runtime, not the filesystem:

```bash
node -p "require.resolve('@scope/package')"
# → /path/to/packages/package/lib/index.js
```

That single line cannot be argued with. Also check the fields that decide resolution — and note that `exports` **overrides** `main` when present:

```bash
node -p "JSON.stringify(require('@scope/package/package.json'), ['main','types','exports','files'])"
```

Then check for path mappings that bypass the package entry entirely (`compilerOptions.paths` in the consumer's `tsconfig.json`), and for deep imports reaching past it:

```bash
rg "@scope/[a-z-]+/(src|lib)/" --glob '!**/node_modules/**'
```

### Telling dead from live

`git log` is a stronger signal than reading the contents:

```bash
git log -1 --format='%h %ad' --date=short -- packages/pkg/src/thing.js
git log -1 --format='%h %ad' --date=short -- packages/pkg/src/thing.ts
```

A compiled file last touched months ago while its `.ts` changed today is dead.

### Proving they were not build inputs

Delete them, then build from scratch:

```bash
npm run clean && npm run build
```

If the output is complete, the removed files contributed nothing.

### Ignore rules: narrow, and test both directions

The obvious rule is too wide. Ignoring `**/src/**/*.d.ts` also swallows **hand-written ambient declarations** — the `declare module 'some-untyped-lib';` files that must stay versioned. Ignore only what is unambiguously generated:

```gitignore
# Compiled output belongs in lib/ only (package.json main + tsconfig outDir).
packages/*/src/**/*.js
```

Then verify **both** directions — that a new artifact is caught, and that a legitimate file still is not:

```bash
touch packages/pkg/src/__probe.js
git check-ignore -v packages/pkg/src/__probe.js   # must match
rm packages/pkg/src/__probe.js
git check-ignore -q packages/pkg/src/vendor-modules.d.ts && echo "BUG: ignoring a real file"
```

Before writing the rule, confirm the assumption it rests on — that no hand-written `.js` exists in those folders:

```bash
find packages/*/src -name '*.js' | wc -l
```

## The general shape

This is the same class as [a NUL byte making grep treat a file as binary](nul-byte-makes-grep-treat-file-as-binary.md): **the tool answered your question truthfully — it just wasn't the question you meant to ask.** "Is that value in a file named `thing.js`?" — no. "Does anything load it?" — never asked.

When a verification step contradicts what you know about the code, suspect the verification step before the code. Anchor checks to a **path** (`lib/thing.js`), never to a bare filename, and prefer a check that names the artifact over one that searches for it.
