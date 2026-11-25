---
title: A Node guard script prints OK and never exits because something it imports loads React
summary: "A build-time check that transpiles and runs part of an SPFx solution in Node can finish its work and still keep the process alive: one import chain that reaches React (often via an i18n or UI helper) opens a MessagePort for React's scheduler. The build then hangs with no error. Keep code that such scripts execute free of React imports, and find the culprit with process._getActiveHandles()"
tags: [spfx, tooling, node, build, react, prebuild, guard-scripts]
applies-to: SPFx (or any React) solutions with custom Node prebuild checks that require/transpile source modules (provisioning steps, manifests, pure services) and run them outside the browser
last-reviewed: 2026-11-25
---

# A Node guard script prints OK and never exits because something it imports loads React

> **Bottom line.** If a prebuild check runs part of your solution in Node (for example it transpiles the provisioning module and calls it with a fake HTTP client), one new import that leads to React is enough to keep the process alive after the check is done: React's scheduler opens a `MessagePort`, and an open port keeps Node running. The check prints its success line and then hangs, so the whole build hangs with no error. Keep modules that such checks execute free of React, i18n hooks and UI packages, and when a script hangs, list what is keeping it alive with `process._getActiveHandles()`.
>
> **Ve zkratce.** Když kontrola v prebuildu spouští část řešení v Node (třeba transpiluje modul provisioningu a zavolá ho s falešným HTTP klientem), stačí jeden nový import vedoucí na React a proces po hotové kontrole neskončí: plánovač Reactu otevře `MessagePort` a otevřený port drží Node naživu. Kontrola vypíše úspěch a visí, takže visí celý build – bez chyby. Moduly, které takové kontroly spouštějí, drž bez Reactu, i18n hooků a UI balíčků; a když skript visí, vypiš, co ho drží, přes `process._getActiveHandles()`.

## Symptom

- `npm run build` (or your prebuild chain) stops after a guard prints its final `OK` line. No error, no failed test, CPU near zero.
- Wrapping the prebuild in `timeout` ends with exit code 124.
- The guard passed in the previous build; the only change is a new import somewhere in the code it executes.

## Cause

The guard loads a source module (here a provisioning service) through `require`, with a TypeScript transpile hook and stubbed `@microsoft/sp-http`. The new step imported a small helper, the helper imported a shared HTTP utility, and that utility imported the solution's i18n module – which imports `react` and a UI package for its hooks.

Loading React in Node initialises its scheduler, which uses a `MessageChannel`. An open `MessagePort` is an active handle, so the event loop never empties and the process never exits, even though every promise in the check has settled.

Measured with a wrapper:

```js
// hang-probe.js – run the guard, then print what keeps the process alive
const t = setTimeout(() => {
  const hs = process._getActiveHandles().filter(h => h !== t);
  console.error(hs.map(h => h.constructor && h.constructor.name).join('\n'));
  process.exit(0);
}, 15000);
t.unref();
require('./scripts/check-something.js');
```

Output: `MessagePort` and `Socket` (stdout). After moving the step into a module without the React chain, the same guard finished in 1.5 s.

## Fix

- Code that guard scripts execute in Node (provisioning steps, manifests, pure calculations) imports only libraries that have no UI dependency, plus its own folder. No imports from services that reach i18n hooks, components or a UI package.
- When a step needs logic that a UI-side service also uses, split it: a light module with the constants and the step itself, which the service re-exports.
- Diagnose hangs with the probe above instead of re-running the build and waiting.
- Optional belt and braces: guards that know they are finished can end with an explicit `process.exit(0)`. That hides the import problem rather than fixing it, so do it only in addition to keeping the module light.
