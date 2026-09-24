---
title: A component from a linked package throws "Invalid hook call" in Jest — the test loaded a second copy of React
short-title: A component from a linked package throws "Invalid hook call" in Jest
summary: Jest resolves a `file:`/junction package by its real path, so the package's `require('react')` finds a second copy; map `react` and `react-dom` to the app's copy (the SPFx build is unaffected — React is a platform component)
tags: [tooling, jest, testing, react, spfx, monorepo, npm-link]
applies-to: Jest (verified with SPFx 1.22 / Heft, React 17) when a component package is installed as a `file:` dependency, symlink or Windows junction that has its own node_modules
last-reviewed: 2026-09-24
---

# A component from a linked package throws "Invalid hook call" in Jest — the test loaded a second copy of React

> **Bottom line.** When your app consumes a shared component package through a `file:` dependency (a symlink or, on Windows, a junction), Jest resolves the package by its **real** path. Inside it, `require('react')` then finds the React in the *package repository's* `node_modules` — a second copy, not the one your test renders with — and any component of the package that uses hooks dies with "Invalid hook call". The app itself is fine, because SPFx provides React to the bundle at runtime. Map `react` and `react-dom` to the app's copy in the Jest config.
>
> **Ve zkratce.** Když appka bere sdílený balíček komponent přes `file:` závislost (symlink, ve Windows junction), Jest ho resolvuje po **skutečné** cestě. `require('react')` uvnitř balíčku pak najde React v `node_modules` *repozitáře balíčku* – druhou kopii, ne tu, kterou vykresluje test – a každá komponenta balíčku s hooky spadne na „Invalid hook call“. Appka sama je v pořádku, protože React jí za běhu dodává SPFx. V jest konfiguraci namapuj `react` a `react-dom` na kopii appky.

## Symptom

A test that renders a whole view or page fails as soon as the tree contains a component from your shared package that uses hooks — a page header, a pager:

```
Error: Uncaught [Error: Invalid hook call. Hooks can only be called inside of the body of a function component.
This could happen for one of the following reasons: …
```

The same page works in the browser. Tests of your own components pass; only the ones that include a component from the linked package fail. The easy way out — "test the blades separately, skip the page" — quietly drops the part you wanted to test.

## Cause

```
app/
  node_modules/react                 ← the copy your test renders with
  node_modules/@acme/ui  ──junction──►  shared/packages/ui/
shared/
  node_modules/react                 ← dev dependency of the package repository
  packages/ui/lib/PageHeader.js      ← require('react') resolves HERE, walking up from the real path
```

Jest follows the link to the package's real location and resolves its imports from there. Two copies of React means two hook dispatchers: the component calls `useState` on a React that is not the one currently rendering.

The production build is not affected in an SPFx project: React is a platform-provided component (the component manifest lists it under `scriptResources` as `"type": "component"`), so neither copy is bundled.

## Fix

Pin React to one copy in the app's Jest configuration:

```json
{
  "moduleNameMapper": {
    "^react$": "<rootDir>/node_modules/react",
    "^react-dom$": "<rootDir>/node_modules/react-dom",
    "^react-dom/(.*)$": "<rootDir>/node_modules/react-dom/$1"
  }
}
```

In a Heft project `moduleNameMapper` from the app is merged with the rig's (other mappings such as a stub for `@microsoft/sp-http` stay). Add the mapping as soon as a test renders anything from the shared package — without it the test fails on the hook, not on an assertion, and proves nothing.

## Notes

- The same applies to any library that must be a singleton across the tree (a context provider from the package, a router, a state store).
- Duplicate React is also the classic cause of this error in production bundles; if you ever see it outside Jest, check whether your bundler resolves the linked package's `react` separately.
- Related: [`jest.mock()` doesn't hoist under Heft](../spfx/jest-mock-doesnt-hoist-in-heft.md).
