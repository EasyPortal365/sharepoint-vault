---
title: "`global.navigator = dom.window.navigator` is ignored on Node 21+ (or throws) — your jsdom test runs with Node's navigator"
short-title: "`global.navigator = …` for jsdom is ignored on Node 21+"
summary: Node 21 added a global `navigator` that has a getter and no setter, so the classic hand-made jsdom setup line is silently ignored (strict mode throws a TypeError) and the test sees Node's `userAgent` (e.g. "Node.js/24") and no `onLine`; define the property with `Object.defineProperty` and assert it took effect
tags: [tooling, testing, jsdom, node, spfx]
applies-to: Tests that set up jsdom by hand in plain Node (a script or test runner without a jsdom environment package), Node.js 21 and later
last-reviewed: 2026-09-26
---

# `global.navigator = dom.window.navigator` is ignored on Node 21+ (or throws) — your jsdom test runs with Node's navigator

> **Bottom line.** Since Node.js 21 the global `navigator` is Node's own object, exposed through a getter with no setter. The usual jsdom setup line `global.navigator = dom.window.navigator` is therefore **silently ignored** in sloppy mode and **throws** in strict mode — the test keeps Node's navigator (on Node 24 `userAgent` "Node.js/24", no `onLine`, no `cookieEnabled`) while you believe it runs in a browser-like one. Use `Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })` and check `navigator === dom.window.navigator`.
>
> **Ve zkratce.** Od Node.js 21 je globální `navigator` vlastní objekt Node, dostupný přes getter bez setteru. Obvyklý řádek nastavení jsdom `global.navigator = dom.window.navigator` se proto v běžném režimu **tiše neprovede** a ve strict režimu **spadne** – test dál běží s navigatorem Node (na Node 24 `userAgent` „Node.js/24“, bez `onLine` a `cookieEnabled`), i když si myslíte, že běží v prostředí podobném prohlížeči. Použijte `Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })` a ověřte `navigator === dom.window.navigator`.

## Symptom

A test file that builds its own DOM:

```js
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
```

- Without `'use strict'`: no error. `navigator.userAgent` is Node's (`Node.js/24` on Node 24, in general `Node.js/<major>`), not the jsdom user agent, and `navigator.onLine` is `undefined`. Tests that do not read those properties stay green, so nothing tells you.
- With `'use strict'` (or the same setup in an ES module, using `import`):

```
TypeError: Cannot set property navigator of #<Object> which has only a getter
```

## Cause

Node.js 21.0.0 added a global `navigator` (documented as active development; since 21.2.0 it can be switched off with `--no-experimental-global-navigator`). On Node 24.16 its property descriptor is an accessor: `get` present, `set` missing, `configurable: true`. Plain assignment to an accessor without a setter is a no-op in sloppy mode and a `TypeError` in strict mode.

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

`configurable: true` keeps `delete globalThis.navigator` in a teardown working; afterwards there is no `navigator` at all – Node's own object does not come back. The alternative is to start Node with `--no-experimental-global-navigator` (it can also be set once through `NODE_OPTIONS`); then Node exposes no `navigator` at all and the plain assignment works again — but every place that runs the tests (package scripts, CI) must get the flag.

## Notes

- Check `Object.getOwnPropertyDescriptor(globalThis, name)` before overwriting any global that Node now provides itself – they differ: on Node 24.16 `crypto` is also a getter without a setter, `performance` has a setter, and `fetch`, `URL` or `Blob` are plain writable properties.
- A line that "cannot fail" deserves an assertion when the test depends on it — the silent version of this trap left 18 test files in one monorepo running with Node's navigator (17 through the ignored assignment, one through an `if (!global.navigator)` guard that never fired); it surfaced only when a new test file with `'use strict'` threw.
