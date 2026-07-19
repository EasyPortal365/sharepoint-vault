---
title: Windows Functions — zip deploy onto a running app corrupts it (whole app 503)
tags: [azure-functions, deployment, github-actions, spfx-backend]
applies-to: Azure Functions (Windows plans; Node.js worker)
last-reviewed: 2026-07-16
---

# Windows Functions: zip deploy onto a running app corrupts it (whole app 503)

> **Bottom line.** On Windows plans, zip-deploying many files onto a live app corrupts it through file locks (the whole app 503s) — re-run the deploy to recover, and set `WEBSITE_RUN_FROM_PACKAGE = 1` so the zip mounts atomically.
>
> **Ve zkratce.** Na Windows plánech poškodí zip deploy mnoha souborů na běžící appku zámky souborů (503 celé instance) – oprav ho opětovným spuštěním deploye a nastav `WEBSITE_RUN_FROM_PACKAGE = 1`, aby se zip připojil atomicky.

SPFx has no server side, so a small Azure Function app is the standard companion for anything
a web part can't do in the browser (CORS-blocked fetches, secrets, OpenAI calls). This trap is
about **deploying** that companion.

## Symptom

A GitHub Actions deploy reports **success**, yet the whole Function App returns
**503 "Function host is not running"** — every endpoint, including ones the commit never touched.
Application Insights shows:

```
ExternalStartupException: Error building configuration in an external startup class
→ node exited with code 1 (0x1)
→ Worker … 14 UNAVAILABLE: No connection established
```

App settings are fine, and — the truly confusing part — **the exact same commit runs happily
on another instance** (a Linux one).

## Cause

The workflow deploys with `Azure/functions-action@v1` and `package: '.'` — thousands of files
(including `node_modules`) copied into a **live** `wwwroot`. On **Windows** plans the running
worker holds file locks, so the copy is partial: some files new, some old, occasionally one
truncated. The next time the host asks the Node worker to index functions, a corrupted module
fails to load and the whole worker dies.

Reading the stack trace tells you which phase died: the frame
`WorkerFunctionMetadataProvider.GetFunctionMetadataAsync` is the host **loading all modules**
that call `app.http(...)` — a crash there means "a module failed to load" (broken file,
missing file), **not** a runtime bug in your handler.

## Fix

**Re-run the deployment.** With the app already down, nothing holds locks — the copy lands
clean and the host starts. A **restart does not help**: corrupted files stay corrupted.

## Prevention: `WEBSITE_RUN_FROM_PACKAGE = 1`

Add the app setting `WEBSITE_RUN_FROM_PACKAGE = 1` (Microsoft's own recommendation for
Windows + zip deploy). Kudu then stores the uploaded zip as **one file** under
`D:\home\data\SitePackages` and the runtime mounts it as a read-only `wwwroot` — one atomic
swap instead of minutes of overwriting live files. Measured on a real Node app with
`node_modules` in the package: the deploy step dropped from **~230 s to 33 s**, and the
file-lock window disappeared entirely.

Mind the order when enabling it on a live app:

1. Add the setting (the app immediately has no package to mount — it is **down** from here),
2. **immediately** trigger a deployment (`workflow_dispatch` re-run is enough),
3. verify. Downtime is roughly the length of one deploy.

Rollback is safe: deleting the setting unmounts the package and reveals the physical
`wwwroot` — which still contains the last extracted deployment.

## Notes

- **Preconditions:** your package must be *ready to run* — build and `npm install` on the CI
  runner, and no `.funcignore` excluding `node_modules`. With run-from-package there is no
  server-side build to reinstall anything, and `wwwroot` is read-only (your code must not
  write next to itself). Not for Flex Consumption plans (documented restriction) — classic
  Consumption, Premium and Dedicated on Windows are fine.
- **Conflicting setting:** `SCM_DO_BUILD_DURING_DEPLOYMENT=true` (remote build) is mutually
  exclusive with run-from-package — remote build needs a writable `wwwroot`. Note that
  `Azure/functions-action@v1` forces it to `false` for its own deploys anyway (visible in the
  log: *"Setting SCM_DO_BUILD_DURING_DEPLOYMENT in Kudu container to false"*), so if CI is
  your only deploy path, the app setting mostly matters for manual zip pushes.
- **Check the live instance, not your IaC template.** Our Bicep template declared
  `SCM_DO_BUILD_DURING_DEPLOYMENT=true`; the live app didn't have the setting at all (the
  instance predated the template). Base decisions on *Environment variables* in the portal,
  not on what a template says should be there.
- **Diagnostic rule that saves an hour:** when the same commit runs on one instance and
  crashes on another, the code is not the cause — diff the environments (OS, deploy method).
  And check the timeline: if the last change was a regex *inside* a handler and the previous
  deploy of the same module worked, module loading cannot be what broke.
- Related trap on the client side of this architecture:
  [`SP.WebProxy` is add-in-only](../spfx/webproxy-is-add-in-only.md) — why the SPFx web part
  needs this Function App in the first place.
