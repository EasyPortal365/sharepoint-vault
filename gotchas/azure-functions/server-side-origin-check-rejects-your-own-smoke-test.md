---
title: A server-side origin check rejects your own smoke test — and the runbook that says "this bypasses CORS"
tags: [azure-functions, cors, spfx, deployment, runbooks, smoke-test]
applies-to: Azure Functions behind an SPFx client (any server-side origin allowlist)
last-reviewed: 2026-09-06
---

# A server-side origin check rejects your own smoke test — and the runbook that says "this bypasses CORS"

> **Bottom line.** Once a function enforces its origin allowlist on the server, every caller needs the `Origin` header — including your deployment script's own smoke test and the verification command in the customer runbook. A runbook that says "this test bypasses CORS, that only affects browsers" is wrong the moment the check moves server-side, and it hands the customer a red error on a perfectly healthy deployment.
>
> **Ve zkratce.** Jakmile funkce vynucuje seznam povolených originů na serveru, potřebuje hlavičku `Origin` každý volající – včetně smoke testu vlastního nasazovacího skriptu a ověřovacího příkazu v zákaznickém návodu. Věta „tenhle test obchází CORS, ten se týká jen prohlížeče" přestane platit v okamžiku, kdy se kontrola přesune na server, a zákazník dostane po zcela zdravém nasazení červenou chybu.

## Symptom

A fresh deployment finishes correctly — resource group, model deployment, function app, API URL all reported fine. Then the verification step fails:

```text
{"error": "Request from a disallowed origin."}
```

…and, in the same run, the deployment script's built-in smoke test reports `FAILED` after three attempts and tells you to check the AI model configuration, which is healthy.

Add the header and the very same call succeeds:

```powershell
Invoke-RestMethod -Method Post -Uri "$api/chat" `
    -Headers @{ Origin = "https://contoso.sharepoint.com" } `
    -ContentType 'application/json; charset=utf-8' -Body $body
```

## Why this happens

CORS as a browser mechanism is advisory: the server answers, the browser decides whether the page may read the answer. That is why "curl bypasses CORS" is true — for CORS.

But an allowlist enforced **inside the function** is not CORS. It is authorization: the handler reads `Origin`, compares it to its configured list, and returns 403 when it does not match. It applies to every caller — browser, curl, PowerShell, a monitoring probe. Fail-closed is usually the right design (a missing configuration must not open the endpoint), so a request with **no** `Origin` at all is refused too.

The trap is that the two live in the same header, so documentation written during the CORS-only era keeps sounding plausible after the behaviour changes.

## Three places it bites

1. **Your own deployment script.** If it deploys the app *and* verifies it, the verification must send the allowlisted origin — and the script already knows it, because the customer passed it in as a parameter. A smoke test that calls the endpoint without the header rejects itself.
2. **The failure message.** Ours advised checking the model configuration, which is one of the least likely causes right after a successful deploy. Order the suspects by probability: cold start still finishing → configured origin does not match what the test sends → upstream service credentials.
3. **The runbook.** Both the verification step *and* the troubleshooting section. Ours contradicted itself: the verification step called a direct reply "success", while troubleshooting listed the same direct reply as the symptom of a misconfigured allowlist. Neither matched reality, because without the header the call never got through at all.

## Fix

- Send the header from anything that verifies the deployment, deriving it from the same configuration value the deployment used.
- Delete every claim that a server-side check "only affects browsers".
- Say explicitly which layer is which: the server-side origin check is verified here; genuine browser CORS is verified later, from the page.
- If you want a probe that needs no header, expose an endpoint that deliberately performs no origin check (a health endpoint returning no data) and point the smoke test at that instead.

## How this got found

Not by reading the code — by a colleague deploying from zero, three separate ways, and actually running the verification command each time. The bug is invisible to anyone who writes the runbook while looking at a system that is already configured, and invisible to tests that call the function the way the app does (with an origin). **Run the verification command from the environment your reader will use.**

## Related

- [Verifying CORS by header presence passes every origin](verifying-cors-by-header-presence-passes-every-origin.md) — the opposite failure: a check that looks like it verifies CORS but accepts anything
- [Rate limit counts the capability probe](rate-limit-counts-capability-probe-corporate-nat.md) — another guard that fires on your own traffic
