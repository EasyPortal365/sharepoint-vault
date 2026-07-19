---
title: Azure OpenAI — a pinned model+version in your deploy script is a time bomb
tags: [azure-functions, azure-openai, deployment, powershell]
applies-to: Azure OpenAI model deployments via `az cognitiveservices` (any IaC/CLI script)
last-reviewed: 2026-07-18
---

# Azure OpenAI: a pinned model+version in your deploy script is a time bomb

> **Bottom line.** A deploy script that hardcodes an Azure OpenAI model version is a time bomb — Azure's "Deprecating" state blocks *new* deployments long before retirement, so resolve the newest GA version at deploy time instead of pinning it.
>
> **Ve zkratce.** Deploy skript s napevno zadanou verzí modelu Azure OpenAI je časovaná bomba – stav „Deprecating" blokuje *nová* nasazení dávno před retirementem, takže verzi nepinuj a nejnovější GA vyhledej až při nasazení.

SPFx (and plenty of other front-ends) have no server side, so a small Azure Function app is the
standard companion for OpenAI calls. This trap is about the **model deployment** that companion
depends on — and why a deploy script that worked for a year suddenly refuses to run.

## Symptom

A previously-working provisioning script fails at model-deployment creation on a **new** resource:

```
(ServiceModelDeprecating) The model 'Format:OpenAI,Name:gpt-4o,Version:2024-08-06' is in
deprecating state and cannot be used for new deployments.
```

Nothing in your script changed. Existing deployments of the same model keep serving fine — it's
only *new* `az cognitiveservices account deployment create` calls that fail.

## Cause

Azure moves a model to the **"Deprecating"** lifecycle state long before it actually retires, and
Deprecating **already blocks creating new deployments** (existing deployments keep working until the
retirement date). A script that hardcodes `--model-name` + `--model-version` therefore ships with a
built-in expiry: the day Azure flips that version to Deprecating, every fresh deployment breaks —
with no change on your side, and a message that sounds like a region/quota problem but isn't.

## Fix — resolve the newest GA version at deploy time

Don't pin the version. Query the region's model catalog right before creating the deployment and
pick the newest **GenerallyAvailable** version that offers your SKU:

```powershell
$models  = az cognitiveservices model list --location $Region -o json | ConvertFrom-Json
$version = ($models
    | Where-Object {
        $_.kind -eq 'OpenAI' -and
        $_.model.name -eq $ModelName -and
        $_.model.lifecycleStatus -eq 'GenerallyAvailable' -and
        (@($_.model.skus | Where-Object { $_.name -eq $Sku }).Count -gt 0)
      }
    | Sort-Object { $_.model.version } -Descending
    | Select-Object -First 1).model.version
```

Keep a hardcoded version only as a **fallback** for when the query returns nothing (offline, or the
model has no GA version in that region — in which case creation should fail loudly, see below).

## The reasoning-model trap that rides along with the fix

When the replacement is a **reasoning model** (GPT-5 family, o-series), the Chat Completions
contract changes: `max_completion_tokens` instead of `max_tokens`, **no `temperature`**, and
`api-version` `2025-04-01-preview` or later. If your app picks the classic-vs-reasoning contract from
the **deployment name** (a common, cheap heuristic — `name.startsWith('gpt-5') || /^o\d/`), then the
deployment name must reflect the family. Deploy a GPT-5 model under the name `gpt-4o` and your app
will send `temperature`, and Azure rejects the call with **400** at chat time — long after the
deployment "succeeded". Rule: **derive the deployment name from the model**, don't leave a stale
default like `gpt-4o` sitting next to a new model.

## Make the failure teach

When creation still fails (model / SKU / quota genuinely unavailable in the region), print the
discovery command *in the error message* so the operator self-serves instead of hitting a dead end:

```
az cognitiveservices model list -l <region> \
  --query "[?kind=='OpenAI' && model.lifecycleStatus=='GenerallyAvailable'].{Model:model.name, Version:model.version}" \
  -o table
```

## Notes

- **Deprecating ≠ retired.** Already-deployed instances keep working until the retirement date, then
  break. Migrating them (add a new GA-model deployment, repoint the app setting that *names* the
  deployment — not just swap the model under the old name, see the reasoning trap) is separate work
  with a hard deadline. Track it the day you hit this, don't discover it at retirement.
- **Sort caveat.** Chat model versions are ISO dates (`2025-08-07`), so a descending string sort
  yields "newest". Numeric-versioned models (some OSS ones use `1`, `11`, …) would need a numeric
  sort — `"11" -lt "2"` is true as strings.
- **Filter in PowerShell, not one opaque JMESPath.** `Where-Object`/`Sort-Object` over the parsed
  JSON is far easier to unit-test against a captured `model list` response than a long `--query`.
- Related trap on the same architecture:
  [Windows zip deploy breaks the running app](windows-zip-deploy-breaks-running-app.md).
