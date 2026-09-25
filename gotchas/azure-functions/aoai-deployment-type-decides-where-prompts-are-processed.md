---
title: "\"Your data stays in the region you chose\" — for Azure OpenAI the deployment TYPE decides where prompts are processed, not the region"
short-title: Azure OpenAI deployment type decides where prompts are processed
summary: "A GlobalStandard deployment in an EU region may process prompts in any Azure region; only Data Zone (EU Data Boundary) or regional Standard keep processing in the zone or geography — write data-location claims from the SKU your script actually creates, and print it"
tags: [azure-functions, azure-openai, data-residency, deployment, gdpr]
applies-to: Azure OpenAI / Microsoft Foundry model deployments created by a script or template (az CLI, Bicep, ARM)
last-reviewed: 2026-09-25
---

# Azure OpenAI: the deployment type, not the region, decides where prompts are processed

> **Bottom line.** Putting an Azure OpenAI resource in an EU region does not keep processing in the EU. With the default *Global Standard* deployment type, Microsoft may process prompts in **any** Azure region; only *Data Zone* (EU Data Boundary) or regional *Standard* keep inference inside the zone or geography. Write every "your data stays in …" sentence from the SKU your deployment script actually creates.

> **Ve zkratce.** Prostředek Azure OpenAI v evropském regionu ještě neznamená zpracování v EU. U výchozího typu nasazení *Global Standard* může Microsoft dotaz zpracovat v **kterémkoli** regionu Azure; zpracování v zóně nebo geografii drží jen *Data Zone* (EU Data Boundary) nebo regionální *Standard*. Každou větu „data zůstávají v …“ piš podle SKU, které nasazovací skript opravdu zakládá.

## Symptom

An app's help page, website or privacy text says something like *"Data stays in Azure in the region
you chose (EU, US, …)"* or *"the AI model runs in your Azure subscription in the EU"*. The deployment
script — like many samples, and in line with Microsoft's own advice to start with Global Standard —
creates the model deployment as `GlobalStandard`. Nobody notices, because everything works and the resource really is in
`swedencentral`.

## Cause

The region is only the resource's address. Microsoft documents three processing scopes
([Deployment types](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/deployment-types)):

| Type (SKU) | Where prompts are processed | Data at rest |
|---|---|---|
| `GlobalStandard` | may be processed in any Azure region | stays in the resource's geography |
| `DataZoneStandard` | only within the Microsoft data zone (EU zone = EU Data Boundary, which can include EFTA countries such as Norway and Switzerland) | geography |
| `Standard` (regional) | within the chosen Azure geography | geography |

New models launch as Global first; Data Zone follows, regional Standard comes last and only for
a small set of models. So "pick a regional deployment for residency" is often not available for the
model you actually use.

## Fix

1. **Choose the type on purpose.** For EU customers `DataZoneStandard` in an EU region is usually the
   practical choice: most current models have it, and in September 2026 it cost about 10 % more per
   token than Global. Check the model's row under *Data Zone Standard* in
   [Region availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability).
2. **Quota is separate per type.** Quota is granted per subscription, region, model **and** deployment
   type — a pre-flight check for `GlobalStandard` quota says nothing about `DataZoneStandard`.
3. **Treat a type change as a new deployment.** Create the new deployment next to the old one,
   repoint the app setting that names the deployment, smoke-test, then retire the old one. A
   provisioning script that finds an existing deployment should leave its type alone and just
   *report* it.
4. **Print the type.** End the deploy script with a line such as
   `Prompt processing: DataZoneStandard – only within the data zone (EU region = EU)`, read from
   `az cognitiveservices account deployment show … --query sku.name`.
5. **Write texts from the SKU.** Help pages, websites, privacy policies and security documents must
   match the type actually deployed — and when only new deployments change, describe both states
   until existing ones are migrated.

## Notes

- Data at rest stays in the geography in all three cases; the difference is **inference**.
- Abuse monitoring may store prompts and completions that its automated checks flag for human
  review, in the resource's geography, unless modified abuse monitoring is approved — which is
  available only to customers managed by a Microsoft account team or in an eligible program.
  Microsoft's current documentation no longer states a retention period (older versions said "up to
  30 days"). This is a separate question from where processing happens.
- For comparison: Microsoft 365 Copilot is an EU Data Boundary service, but its *flex routing*
  (inference in the US, Canada or Australia at peak load) is on by default for eligible EU tenants
  created after 25 March 2026 ([Flex routing](https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-flex-routing)).
- Related: [a pinned model+version is a time bomb](azure-openai-pinned-model-version-is-a-time-bomb.md),
  [429 on a single request is a TPM ceiling](aoai-429-measure-prompt-size-not-frequency.md).
