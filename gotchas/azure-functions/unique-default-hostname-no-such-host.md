---
title: "No such host" for <app>.azurewebsites.net — new function apps get a unique default hostname
tags: [azure-functions, dns, deployment]
applies-to: Azure Functions, Azure App Service (apps created ~mid-2024 and later)
last-reviewed: 2026-08-07
---

# "No such host" for `<app>.azurewebsites.net` — new function apps get a unique default hostname

**Symptom:** your deploy pipeline reports success and the function app runs fine in the portal, but `https://<app-name>.azurewebsites.net` fails DNS resolution entirely (`No such host is known` / `ERR_NAME_NOT_RESOLVED`). Easy to misread as "the app does not exist" or "a transient DNS hiccup" — especially when *older* apps in the same subscription resolve just fine under their bare names.

**Cause:** Azure assigns **unique default hostnames** to newly created apps:

```
https://<app-name>-<random-hash>.<region>-01.azurewebsites.net
```

e.g. `myfunc-gwb7ezbzczaud5ba.westeurope-01.azurewebsites.net`. The bare `<app-name>.azurewebsites.net` is never registered in DNS for these apps. Apps created before the rollout keep their bare hostname — so one subscription routinely contains both kinds, which is exactly what makes the failure look random.

**Fix / rules:**

- **Never derive the hostname from the app name.** Read it from the portal (app Overview → Default domain) or from your deploy log.
- **GitHub Actions tip:** the `Azure/functions-action` log line `Deploy logs can be viewed at https://<app>-<hash>.scm.<region>-01.azurewebsites.net/...` reveals the hostname even when the app name itself is masked as a secret — drop the `.scm` segment to get the runtime host.
- Put the **full** unique hostname into every config that calls the app (client allowlists, webhook URLs, monitoring, other services' env vars).
- When a bare-name call fails DNS but you believe the app exists, that is a *naming* problem, not an outage — check the unique hostname before restarting or redeploying anything.
