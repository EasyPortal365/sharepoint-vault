---
title: In a Heft/SPFx project jest.mock() doesn't hoist — and sp-http drags in a missing MS-internal module
tags: [spfx, jest, testing, heft, sp-http, mocking]
applies-to: SPFx projects built with Heft (@rushstack/heft-jest-plugin), SharePoint Framework 1.1x+
last-reviewed: 2026-07-25
---

# In a Heft/SPFx project `jest.mock()` doesn't hoist — and `sp-http` drags in a missing MS-internal module

> **Bottom line.** A test suite for a service that touches `SPHttpClient` dies with `Cannot find module '@msinternal/ecs-flight'` before the first test runs — and adding `jest.mock('@microsoft/sp-http', …)` doesn't fix it, because Heft runs Jest over pre-compiled `lib-commonjs` **without Babel**, so `jest.mock()` never hoists above `require()`. Use `moduleNameMapper` in the project's `config/jest.config.json` instead.
>
> **Ve zkratce.** Testovací sada služby, která sahá na `SPHttpClient`, spadne na `Cannot find module '@msinternal/ecs-flight'` ještě před prvním testem — a `jest.mock('@microsoft/sp-http', …)` to NEspraví, protože Heft pouští Jest nad předkompilovaným `lib-commonjs` **bez Babelu**, takže se `jest.mock()` nikdy nehoistne nad `require()`. Použij `moduleNameMapper` v projektovém `config/jest.config.json`.

## Symptom

One suite fails to run at all, while the others in the same folder pass:

```
● Test suite failed to run
  Cannot find module '@msinternal/ecs-flight' from 'node_modules/@microsoft/sp-core-library/lib-commonjs/SPFlight.js'
  Require stack:
    node_modules/@microsoft/sp-core-library/lib-commonjs/SPFlight.js
    …
    lib-commonjs/…/MyService.js
    lib-commonjs/…/MyService.test.js
```

The test doesn't make any HTTP calls — it only exercises a pure exported function from the same module. The obvious fix (`jest.mock('@microsoft/sp-http', () => ({ SPHttpClient: { configurations: { v1: {} } } }))` at the top of the test) changes nothing.

## Cause

Two independent layers, and you need both to make sense of it:

**1. Value import vs type-only import.** `@msinternal/ecs-flight` is a Microsoft-internal package that isn't published to your `node_modules`. You only reach it when a real `require('@microsoft/sp-http')` survives compilation — which happens when the module uses something from `sp-http` **as a value**:

```ts
import { SPHttpClient } from '@microsoft/sp-http';
await this._sp.get(url, SPHttpClient.configurations.v1);   // ← value use → require() stays
```

A module that only uses `sp-http` for **types** (`MSGraphClientFactory`, `SPHttpClientResponse`, `ISPHttpClientOptions`) compiles down to *nothing* — TypeScript elides type-only imports, no `require` is emitted, and that suite passes happily. This is why the failure looks arbitrary across sibling test files. Check which case you're in by grepping the **compiled** output, not the source:

```bash
grep -c 'require("@microsoft/sp-http")' lib-commonjs/path/to/MyService.js   # 0 = fine, 1+ = needs a stub
```

**2. No Babel means no hoisting.** `jest.mock()` only works "before the imports" because **babel-plugin-jest-hoist** rewrites the file to lift the call above the `require`s. The Heft rig deliberately avoids Babel — it runs Jest over already-compiled JS and skips transforming it:

```jsonc
"roots": ["<rootDir>/lib-commonjs"],
"transformIgnorePatterns": ["[\\/]lib-commonjs[\\/](.*)\\.js$"],
"coverageProvider": "v8",   // "Use v8 coverage provider to avoid Babel"
```

So your compiled test looks like this, and the mock is registered *after* the module graph has already been loaded and thrown:

```js
"use strict";
var MyService_1 = require("./MyService");   // ← blows up here
jest.mock('@microsoft/sp-http', …);          // ← too late, never reached
```

## Fix

Map the module before anything can `require` it, via `moduleNameMapper` in the **project's** `config/jest.config.json` (Heft's Jest plugin looks for exactly that path; `extends` keeps the rig's settings):

```jsonc
{
  "extends": "@microsoft/spfx-web-build-rig/profiles/default/config/jest.config.json",

  "moduleNameMapper": {
    "^@microsoft/sp-http$": "<rootDir>/config/jest/sp-http.stub.js"
  },

  // the stub lives outside lib-commonjs; skip transforming it so it doesn't need a Babel config
  "transformIgnorePatterns": ["[\\/]lib-commonjs[\\/](.*)\\.js$", "[\\/]config[\\/]jest[\\/](.*)\\.js$"]
}
```

The stub only needs to hold the *shape* of the API so module loading succeeds — tests deliberately don't do network I/O:

```js
// config/jest/sp-http.stub.js
const noop = () => Promise.reject(new Error('sp-http stub: no network in tests'));

class SPHttpClient { get() { return noop(); } post() { return noop(); } fetch() { return noop(); } }
SPHttpClient.configurations = { v1: { name: 'sp-http-stub-v1' } };

module.exports = { SPHttpClient, SPHttpClientResponse: class {}, MSGraphClientFactory: class {} };
```

Keep the stub **outside** `lib-commonjs` — that folder is build output and gets wiped by `--clean`.

If a test ever needs to assert on HTTP behaviour, inject a `jest.fn()` double through the service's constructor (these services take an `SPHttpClient` argument anyway) rather than growing this stub.

## Why it's easy to miss

- The error names a package you've never heard of and points at `node_modules`, so it reads like a broken install — `npm ci` doesn't help.
- Sibling suites importing the *same* `@microsoft/sp-http` pass, because theirs are type-only imports that vanish at compile time.
- `jest.mock()` is the reflex answer and works in most React/Node projects; the Heft "no Babel" choice silently removes the hoisting it depends on.

## See also

- `gotchas/spfx/es2015-lib-forbidden-apis.md` — other places the SPFx toolchain's compile settings surprise you.
