---
title: Jest's 5-second default timeout fails render tests under load, and the timed-out test breaks the next one
short-title: Jest's 5 s default timeout fails render tests under load — and the next test with them
summary: The first jsdom + React test of a suite pays for the cold module load; on a busy build machine it passes 5 s, Jest abandons it while its async render keeps running, and the following test fails with "button not found" or a doubled write. Set `testTimeout` for the project, not per test
tags: [tooling, jest, testing, spfx, heft, ci]
applies-to: Jest 29 (verified on Jest 29.5 through Heft 1.1 in SPFx 1.22 projects, jsdom environment, React 17); any project whose release build runs render tests on a shared or busy machine
last-reviewed: 2026-11-05
---

# Jest's 5-second default timeout fails render tests under load, and the timed-out test breaks the next one

> **Bottom line.** Jest gives every test 5 seconds by default. A render test (jsdom + React) that mounts a whole screen pays for loading the component tree on its first run, and on a machine busy with other builds that alone can exceed 5 s. Jest then fails the test — but it does not stop the test's async work, so its render and writes leak into the next test, which fails too with an unrelated-looking error. Set `"testTimeout"` once in the project's Jest config (we use 20 s) instead of patching single tests.
>
> **Ve zkratce.** Jest dává každému testu ve výchozím stavu 5 sekund. Vykreslovací test (jsdom + React), který připojí celou obrazovku, při prvním běhu platí za načtení stromu komponent a na stroji vytíženém jinými buildy to samo přesáhne 5 s. Jest pak test shodí – jeho asynchronní práci ale nezastaví, takže render a zápisy prosáknou do dalšího testu, který spadne taky s chybou, jež vypadá nesouvisle. Nastav `"testTimeout"` jednou v jest konfiguraci projektu (my používáme 20 s), ne po jednotlivých testech.

## Symptom

A release build that runs the test suite as its gate (`heft test --clean --production` in SPFx) fails with ten failures in six suites, while two other production builds share the CPU. All six suites have the same shape:

- the **first** test fails with `thrown: "Exceeded timeout of 5000 ms for a test."`,
- in four of the six, the **second** test fails too, with something that looks like a real bug: `button "Save date" not found`, an input field not found, or `expect(writes.length).toBe(1)` receiving `2`.

## Cause

Two things combine:

1. **The first test of a suite is the slowest.** It is the one that requires the screen's modules and mounts the full React tree for the first time. With two other production builds sharing the CPU, that first test took over five seconds; the tests after it in the same suite did not.
2. **A timeout does not cancel the test.** Jest's runner (`jest-circus`, `callAsyncCircusFn`) races the test against a `setTimeout` and rejects when the timer wins — nothing stops the test function itself, and a JavaScript promise cannot be cancelled from outside. Jest marks the test failed and moves on, but the test's pending promises keep resolving. The abandoned test keeps clicking, rendering and recording writes in shared fixtures, while the next test has already mounted its own tree into the same `document.body`. The next test then finds two trees or none, or counts writes from both.

So one environmental cause shows up as one or two failures per suite, and only the first one names the real reason.

## Fix

Set the limit for the whole project in its Jest config:

```jsonc
// config/jest.config.json (SPFx / Heft) – or jest.config.js elsewhere
{
  "extends": "@microsoft/spfx-web-build-rig/profiles/default/config/jest.config.json",
  "testTimeout": 20000
}
```

Then rerun the build with the same version.

## How to tell a timeout from a real bug

- Look at the **first** failure of each failing suite. If it is `Exceeded timeout`, treat the failures after it in that suite as consequences, not findings.
- A real bug fails **without load too**: run that suite on its own (after the release, never between building and publishing the package).
- Do not "fix" it by giving one test `it(name, fn, 30000)` or by raising the limit for one run — the cause is the machine, not the test, and the next busy build hits a different suite.

## Related

- [`heft --clean` leaves stale tests in `lib-commonjs`](../spfx/heft-clean-leaves-stale-lib-commonjs-tests.md)
- [A test outside the release command guards nothing](../spfx/a-test-outside-the-release-command-guards-nothing.md)
