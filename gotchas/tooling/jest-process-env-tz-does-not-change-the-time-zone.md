---
title: Setting process.env.TZ inside Jest does not change the time zone
short-title: Setting `process.env.TZ` inside Jest does not change the time zone
summary: A test, `setupFiles` and `setupFilesAfterEnv` write into the sandbox's copy of `process.env`, so day-boundary tests pass only on machines already in the right zone; pin it in `globalSetup`, assert the offset, and run once under a foreign `TZ` (not from Git Bash on Windows)
tags: [tooling, jest, testing, dates, time-zone]
applies-to: Jest (verified on Jest 29.5 with jest-environment-node, Node.js 24); any project with date or day-boundary tests
last-reviewed: 2026-09-24
---

# Setting `process.env.TZ` inside Jest does not change the time zone

> **Bottom line.** In Jest, `process.env.TZ = '…'` written in a test, in `setupFiles` or in `setupFilesAfterEnv` changes nothing: the test runs in a sandbox with its own copy of `process.env`, and the real process keeps the zone it started with. Day-boundary tests then pass only because the machine happens to sit in the right zone. Pin the zone in `globalSetup` (or in the environment that launches Jest), and let the test assert the offset itself.
>
> **Ve zkratce.** V jestu `process.env.TZ = '…'` zapsané v testu, v `setupFiles` nebo v `setupFilesAfterEnv` nezmění nic: test běží v sandboxu s vlastní kopií `process.env` a skutečný proces si drží pásmo, se kterým startoval. Testy hranice dne pak procházejí jen proto, že stroj náhodou sedí ve správném pásmu. Pásmo připni v `globalSetup` (nebo v prostředí, které jest spouští) a ať test sám ověří offset.

## Symptom

A suite with day-boundary cases — 22:00 UTC on 31 August is already 1 September in Central Europe — is green on every developer machine. The project "pins" the zone in a setup file:

```js
// jest.config.json: "setupFiles": ["<rootDir>/config/jest/tz.js"]
process.env.TZ = 'Europe/Prague';
```

Run the same suite with the parent process in another zone and it goes red: in our projects six tests failed, and nine once the date helper was switched back to UTC. A `console.log` inside the test even shows `process.env.TZ === 'Europe/Prague'` — while `new Date(2026, 0, 1).getTimezoneOffset()` still returns the parent's offset.

## Cause

Jest runs each test file in a sandbox whose `process` object is a copy, and its `process.env` is a separate object filled from the real environment (`jest-util`, `createProcessEnv`: a proxy populated with `Object.assign(proxy, process.env)`). An assignment in a test, in `setupFiles` or in `setupFilesAfterEnv` lands in that copy; the real environment of the process never changes, so neither does its time zone.

`globalSetup` runs in the parent Jest process before the test files run. An assignment there changes the real environment, and worker processes started afterwards inherit it.

Measured with the parent in `America/New_York`, the same one-line test (`expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60)`):

| Where `TZ` is set | Test sees `process.env.TZ` | Offset | Result |
|---|---|---|---|
| nowhere | `America/New_York` | 300 | fail |
| inside the test | `Europe/Prague` | 300 | fail |
| `setupFiles` | `Europe/Prague` | 300 | fail |
| `setupFilesAfterEnv` | `Europe/Prague` | 300 | fail |
| `globalSetup`, in band | `Europe/Prague` | −60 | pass |
| `globalSetup`, two workers | `Europe/Prague` | −60 | pass |

With no `TZ` on a machine that already runs in Central European time, all six rows pass — which is exactly why nobody noticed.

## Fix

```js
// config/jest/global-setup.js — referenced as "globalSetup" in the Jest config
module.exports = async () => {
  process.env.TZ = 'Europe/Prague';
};
```

- **Assert the zone in the test, by offset.** `expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-60)` fails loudly when the pin does not work; reading `process.env.TZ` proves nothing, because the sandbox copy says whatever was written into it.
- **Run the day-boundary suite at least once under a foreign `TZ`.** A pin that was never tested against another zone has never been shown to work.
- **On Windows, set it from PowerShell** (`$env:TZ = 'America/New_York'`). In our Git Bash for Windows, `TZ=America/New_York node -p "process.env.TZ"` printed `undefined` — the variable did not reach the native `node` process, so a "foreign zone" run from there silently used the machine's zone.

## Notes

- The alternative to `globalSetup` is the environment that launches Jest (`TZ=Europe/Prague jest` in a POSIX shell, `$env:TZ` in PowerShell); anything set later, inside the test runtime, is too late.
- [Setting process.env.TZ does not affect Dates (jestjs/jest #9856)](https://github.com/jestjs/jest/issues/9856)
- Related: [A test outside the release command guards nothing](../spfx/a-test-outside-the-release-command-guards-nothing.md) · [DateTime: write full ISO, derive days locally](../rest-api/datetime-write-full-iso-read-local-day.md)
