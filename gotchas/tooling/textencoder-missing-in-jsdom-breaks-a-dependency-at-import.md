---
title: "`TextEncoder is not defined` before your first test runs — a dependency needs it at import time and jsdom does not have it"
short-title: "`TextEncoder is not defined` before your first test runs"
summary: jsdom has no Encoding API and a dependency that builds `new TextEncoder()` at module level dies on import, before `beforeAll`; import a polyfill module first or use `setupFiles`, and make the dependency lazy
tags: [tooling, jest, jsdom, testing, spfx, polyfill]
applies-to: Jest with the jsdom test environment (seen in SPFx 1.22 / Heft projects) when any imported module calls `new TextEncoder()` at module level
last-reviewed: 2026-09-24
---

# `TextEncoder is not defined` before your first test runs — a dependency needs it at import time and jsdom does not have it

> **Bottom line.** The jsdom environment in Jest has no `TextEncoder`/`TextDecoder`. A module that creates one at module level (`const enc = new TextEncoder();`) therefore throws while it is being **imported** — so when that module is a dependency of the component under test, the whole suite dies before `beforeAll` could add a polyfill. Load the polyfill as a separate module imported **first**, or list it in the project's `setupFiles`; the lasting fix is for the dependency to create the encoder lazily.
>
> **Ve zkratce.** Prostředí jsdom v jestu nemá `TextEncoder`/`TextDecoder`. Modul, který ho vytváří na úrovni souboru (`const enc = new TextEncoder();`), proto spadne už při **importu** – a když je to závislost testované komponenty, celá sada skončí dřív, než by `beforeAll` stihl doplněk přidat. Doplněk načti jako samostatný modul importovaný **první**, nebo ho dej do `setupFiles` projektu; trvalá oprava je, aby si závislost encoder vytvářela líně.

## Symptom

A component test fails with zero tests run:

```
● Test suite failed to run
  ReferenceError: TextEncoder is not defined
    > 27 | const enc = new TextEncoder();
    at Object.<anonymous> (../shared/packages/license/src/crypto.ts:27:13)
```

The stack points into a package you did not touch — a licensing or crypto helper that the component reaches through a context provider. Service tests in the same project (no jsdom, no component) pass.

## Cause

- jsdom does not implement the Encoding API, and the Jest jsdom environment does not copy Node's `TextEncoder` onto the window.
- A constant at module level is evaluated when the module is imported. Imports run before the body of the test file, so a polyfill written in `beforeAll` — or anywhere below the imports — comes too late. The failure is in the import of the module under test, not in any test.

## Fix

A side-effect module that fills the gap from Node, imported as the **first** line of the test (imports are evaluated in declaration order, so it runs before the dependency is loaded):

```ts
// testPolyfills.ts — imported only by tests, never by the bundle
const nodeUtil = require('util') as { TextEncoder?: unknown; TextDecoder?: unknown };
const w = window as unknown as { TextEncoder?: unknown; TextDecoder?: unknown };
if (!w.TextEncoder) w.TextEncoder = nodeUtil.TextEncoder;
if (!w.TextDecoder) w.TextDecoder = nodeUtil.TextDecoder;
export {};
```

```ts
import './testPolyfills';          // FIRST
import * as React from 'react';
import { LicensedPage } from './LicensedPage';
```

For every suite at once, put the same file into the project's `setupFiles`. In a Heft project that does not replace the rig's own `setupFiles` entry: `@rushstack/heft-config-file` (0.19.x) appends arrays inherited through `extends` by default, and `heft-jest-plugin` does not override that for `setupFiles` (read in the source; we used the first-import route).

The lasting fix belongs in the dependency: create platform objects lazily, inside the function that needs them (`function enc() { return new TextEncoder(); }`), so importing the module never requires them.

## Notes

- The same applies to anything a module touches at import time: `crypto.subtle`, `matchMedia`, `ResizeObserver`.
- After adding a polyfill, assert that it is there (`expect(typeof TextEncoder).toBe('function')`) — otherwise a later refactor can make the suite green because the code path no longer runs at all.
