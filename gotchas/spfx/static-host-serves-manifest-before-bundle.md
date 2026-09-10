---
title: Polling the manifest proves nothing — a static host serves the small file first
tags: [spfx, cdn, deployment, github-pages, library-component]
applies-to: SharePoint Framework library components hosted on a static CDN (GitHub Pages, any object store fronted by a CDN)
last-reviewed: 2026-09-10
---

# A 200 on `manifest.json` does not mean the component will load

> **Bottom line.** When an SPFx library component lives on a static host, one deploy publishes a ~1 kB `manifest.json` and a ~1 MB bundle — and the small one becomes reachable first. Between the two, the web part loads *nothing* and logs *nothing*: an empty host element is indistinguishable from a component that chose to render nothing. A release check that polls only the manifest reports success into that window.
>
> **Ve zkratce.** U SPFx knihovní komponenty na statickém hostingu se z jednoho nasazení objeví malý `manifest.json` dřív než velký bundle. V mezidobí web part nevykreslí nic a nic nezaloguje — prázdná plocha vypadá stejně jako komponenta, která se rozhodla nekreslit. Kontrola, která pollí jen manifest, ohlásí do toho okna úspěch.

## Symptom

Two of six components published in one batch rendered an empty page immediately after release:
the web part's host element had zero children, its canvas had height 0, and the browser console
was **clean** — no exception, no failed-import warning. The other four from the same batch were fine.
The release script had already reported success, and a `curl` on
`<app>/<version>/manifest.json` returned **200 for all six**.

## Why it happens

A static host does not make the files of one commit reachable atomically from the browser's point of
view. The manifest is small and appears almost immediately; the entry bundle it points at is three
orders of magnitude larger and lands later. In that gap the SPFx module loader cannot resolve the
entry module, so `mount()` is never called. Nothing throws, because nothing got far enough to throw.

## The trap that follows

The obvious next step — pin the previous version and compare — produces a *convincing* false
positive. The previous version's files have been on the host for weeks, so they are certainly
deployed; the new version's are minutes old. Both are then loaded in the same browser, same account,
same page, and the old one renders while the new one does not.

**That A/B does not compare code. It compares deploy age.** Reading it as a regression costs a halted
release and a diagnosis that has to be retracted.

## Rule

Verify the artefact that actually **starts** the component, not the smallest file next to it:

```bash
BASE="https://<your-cdn-host>/<app>/<version>"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/manifest.json?cb=$RANDOM"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/<entry-bundle>_<hash>.js?cb=$RANDOM"
```

Take the bundle's filename from the deployed tree (`git ls-tree --name-only HEAD <app>/<version>/`
for a git-backed host), never from memory — the content hash changes with every build. Until **both**
return 200, an empty screen is the expected state, not a finding.

Two corollaries:

- **Do not declare a regression on a freshly published version** before the deploy has settled and
  the symptom reproduces. Let time pass and measure again.
- **A counterexample must differ in exactly one variable.** Here two differed at once — the code and
  the deploy age — and the difference was attributed to the first.

## Related

- Cache-bust every poll (`?cb=`), or an intermediate cache will answer for the state you are trying
  to measure.
- The same reasoning applies to any release check: assert on the file the change actually produced,
  not on one that could have been sitting there already.
