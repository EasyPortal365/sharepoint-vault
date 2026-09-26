---
title: "`global.navigator = dom.window.navigator` does nothing on Node 21+ — your jsdom test runs with Node's navigator"
short-title: "`global.navigator = …` for jsdom is ignored on Node 21+"
summary: Node 21 added a global `navigator` that has a getter and no setter, so the classic hand-made jsdom setup line is silently ignored (strict mode throws a TypeError) and the test sees `userAgent` "Node.js/24" and no `onLine`; define the property with `Object.defineProperty` and assert it took effect
tags: [tooling, testing, jsdom, node, spfx]
applies-to: Tests that set up jsdom by hand in plain Node (a script or test runner without a jsdom environment package), Node.js 21 and later
last-reviewed: 2026-09-26
---

# `global.navigator = dom.window.navigator` does nothing on Node 21+ — your jsdom test runs with Node's navigator

> **Bottom line.** Since Node.js 21 the global `navigator` is Node's own object, exposed through a getter with no setter. The usual jsdom setup line `global.navigator = dom.window.navigator` is therefore **silently ignored** in sloppy mode and **throws** in strict mode — the test keeps Node's navigator (`userAgent` "Node.js/24", no `onLine`, no `cookieEnabled`) while you believe it runs in a browser-like one. Use `Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })` and check `navigator === dom.window.navigator`.
>
> **Ve zkratce.** Od Node.js 21 je globální `navigator` vlastní objekt Node, dostupný přes getter bez setteru. Obvyklý řádek nastavení jsdom `global.navigator = dom.window.navigator` se proto v běžném režimu **tiše neprovede** a ve strict režimu **spadne** – test dál běží s navigatorem Node (`userAgent` „Node.js/24“, bez `onLine` a `cookieEnabled`), i když si myslíte, že běží v prostředí prohlížeče. Použijte `Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })` a ověřte `navigator === dom.window.navigator`.

## Symptom

A test file that builds its own DOM:

```js
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
```

- Without `'use strict'`: no error. `navigator.userAgent` is `Node.js/24`, not the jsdom user agent, and `navigator.onLine` is `undefined`. Tests that do not read those properties stay green, so nothing tells you.
- With `'use strict'` (or in an ES module):

```
TypeError: Cannot set property navigator of #<Object> which has only a getter
```

## Cause

Node.js 21.0.0 added a global `navigator` (documented as active development, switchable off with `--no-experimental-global-navigator`). On Node 24.16 its property descriptor is an accessor: `get` present, `set` missing, `configurable: true`. Plain assignment to an accessor without a setter is a no-op in sloppy mode and a `TypeError` in strict mode.

The two objects are not interchangeable. Measured on Node 24.16 with jsdom 24.1:

| | Node's `navigator` | jsdom's `navigator` |
|---|---|---|
| `userAgent` | `Node.js/24` | `Mozilla/5.0 (win32) … jsdom/24.1.3` |
| `onLine`, `cookieEnabled`, `vendor`, `plugins`, `appVersion` | missing | present (`onLine` is `true`) |
| `hardwareConcurrency`, `language`, `languages`, `platform` | present | present |
| `locks` | present | missing |

So a component that sniffs `userAgent`, checks `onLine` or reads `cookieEnabled` sees a different world than the test author assumed.

## Fix

Replace the assignment with a property definition (the existing property is configurable, so this is allowed):

```js
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true
});
if (navigator !== dom.window.navigator) throw new Error('test setup: navigator is not the jsdom one');
```

`configurable: true` keeps `delete globalThis.navigator` in a teardown working. The alternative is to start Node with `--no-experimental-global-navigator`; then Node exposes no `navigator` at all and the plain assignment works again — but every place that runs the tests (package scripts, CI) must pass the flag.

## Notes

- The same applies to any global that Node started to provide itself: check `Object.getOwnPropertyDescriptor(globalThis, name)` before overwriting it.
- A line that "cannot fail" deserves an assertion when the test depends on it — the silent version of this trap left 18 test files in one monorepo running with Node's navigator without a single red test.
