---
title: A brand-new Azure subscription blocks your first Function App deployment
tags: [azure-functions, deployment, quota, arm, bicep, powershell]
applies-to: First deployment of a Function App (ARM/Bicep or CLI) into a newly created Azure subscription
last-reviewed: 2026-09-11
---

# A brand-new Azure subscription blocks your first Function App deployment

> **Bottom line.** A deploy script that works on every established subscription can fail four different ways on a brand-new one — and the loudest failure, `Current Limit (Y1 VMs): 0`, looks like a region problem but is a **subscription** quota that no region change will fix. Register the resource providers up front, and turn the deployment's raw ARM error into a diagnosis instead of forwarding it.
>
> **Ve zkratce.** Deploy skript, který funguje na zaběhnutých subscription, může na čerstvé selhat čtyřmi různými způsoby – a ten nejhlasitější, `Current Limit (Y1 VMs): 0`, vypadá jako problém regionu, ale je to kvóta **subscription**, se kterou změna regionu nepohne. Resource providery registruj předem a chybu deploymentu rozeber, místo abys ji jen přeposlal.

A deployment script that had run cleanly at several customers was pointed at a subscription created
the same week. Six runs, four distinct errors, nothing deployed. None of them were bugs in the
script — all four are properties of a subscription in which nothing has ever been created.

## Symptom

In the order they appeared:

```
(MissingSubscriptionRegistration) The subscription is not registered to use namespace
'Microsoft.CognitiveServices'.

{"code": "RequestDisallowedByAzure", "message": "Resource '…' was disallowed by Azure:
The selected region is currently not accepting new customers: https://aka.ms/locationineligible."}

(InvalidResourceGroupLocation) Invalid resource group location 'germanywestcentral'.
The Resource group already exists in location 'westeurope'.

(FlagMustBeSetForRestore) An existing resource with ID '…/accounts/<name>' has been soft-deleted.

{"code": "SubscriptionIsOverQuotaForSku", "message": "Operation cannot be completed without
additional quota. Additional details - Location:  Current Limit (Y1 VMs): 0 Current Usage: 0
Amount required for this deployment (Y1 VMs): 1"}
```

The last one repeated in three different regions. The operator did the reasonable thing —
tried another region each time — and got the same wall.

## Cause

**1. The Consumption (`Y1`) quota starts at zero on new subscriptions.** App Service keeps its own
per-SKU worker quotas, separate from Compute quotas, and newly created subscriptions are provisioned
with zero of them until you ask. The quota is tracked **per subscription**, so every region fails
identically — and the error message shows an empty `Location:` field, which makes it read like a
regional issue. Worse, it can't be probed reliably up front: `az appservice list-locations --sku Y1`
lists regions the SKU exists in, not regions where your limit is non-zero, so it happily lists a
region you cannot deploy into.

**2. Resource providers are not registered.** For a resource you create directly (a Cognitive
Services account, say) the error says so plainly. For a resource created *inside* an ARM deployment,
the same condition shows up buried in the deployment's `details` array as
`Failed to register resource provider 'microsoft.operationalinsights'` — so the whole thing reads
like a broken template rather than an unconfigured subscription.

**3. A deleted Cognitive Services account keeps its name.** Soft-delete removes it from the active
listing (so an existence check says "not there") while still reserving the name, and `create` fails
with `FlagMustBeSetForRestore`.

**4. `az group create` is not idempotent across regions.** Called with a different `--location` than
an existing resource group has, it is a hard error — even though a resource group's region is only
metadata and the resources themselves are placed by the template's own `location` parameter.

## Fix

**Register the providers before you touch anything.** Registration is idempotent, free, one-time and
takes tens of seconds. Do it in the script rather than documenting it in a troubleshooting section:

```powershell
$required = @(
    'Microsoft.Web',                  # Function App + App Service plan
    'Microsoft.Storage',
    'Microsoft.Insights',             # Application Insights
    'Microsoft.OperationalInsights',  # Log Analytics, reached by App Insights
    'Microsoft.CognitiveServices'
)
$pending = @()
foreach ($ns in $required) {
    $state = az provider show --namespace $ns --query 'registrationState' -o tsv 2>$null
    if ($LASTEXITCODE -eq 0 -and $state -and $state.Trim() -eq 'Registered') { continue }
    az provider register --namespace $ns -o none 2>$null
    if ($LASTEXITCODE -eq 0) { $pending += $ns }
    else { Write-Host "$ns : cannot register - the account may lack subscription-level rights" }
}
# then poll `az provider show` for $pending until Registered, with a deadline
```

Note the failure branch: registration needs `*/register/action` on the subscription. If the deploying
account doesn't have it, say so — don't silently continue into a deployment that will fail later.

**Raise the quota, or pick a different SKU family.** Azure Portal → *Quotas* → App Service (or
*Subscriptions* → subscription → *Usage + quotas*) → the entry for your SKU in the target region →
request at least 1. Requests of this size are typically auto-approved within minutes; the support
route is *Help + support* → *Create support request* → "Service and subscription limits (quotas)".
If you can't wait, a dedicated plan (`B1`) is a different quota family and may go through — but it is
not a guaranteed escape, because `Basic VMs` can be zero on a new subscription too.

Parameterizing the plan SKU is worth doing anyway, but mind what else changes with it:

```bicep
@allowed([ 'Y1', 'B1', 'B2', 'S1', 'P0v3', 'EP1' ])
param planSku string = 'Y1'

var planTiers = { Y1: 'Dynamic', B1: 'Basic', B2: 'Basic', S1: 'Standard', P0v3: 'PremiumV3', EP1: 'ElasticPremium' }

// WEBSITE_CONTENTAZUREFILECONNECTIONSTRING / WEBSITE_CONTENTSHARE belong to Consumption and
// Elastic Premium only — on a dedicated plan the content lives on the instance.
var usesContentShare = planSku == 'Y1' || planSku == 'EP1'

// A dedicated plan idles out after ~20 minutes without Always On, and takes your timer
// triggers with it — silently. On Consumption the property must not be set at all.
var isDedicated = planSku != 'Y1' && planSku != 'EP1'
```

Derive the tier from the SKU rather than taking both as parameters: "SKU `B1` + tier `Dynamic`" is a
mismatch nobody would pass on purpose, and ARM rejects the plan for it.

**Diagnose the deployment error instead of forwarding it.** Capture the output, match it against the
known signatures, and print what to do about each — the raw ARM JSON sends the operator hunting
through the template for a problem that lives in the subscription:

```powershell
if ($text -match 'SubscriptionIsOverQuotaForSku' -or $text -match 'VMs\)\s*:\s*0') { <# quota guidance #> }
if ($text -match 'RequestDisallowedByAzure' -or $text -match 'not accepting new customers') { <# try another region #> }
if ($text -match 'MissingSubscriptionRegistration' -or $text -match 'Failed to register resource provider') { <# register #> }
```

In PowerShell 5.1, wrap the capture in `$ErrorActionPreference = 'Continue'`: with `Stop` in effect,
redirecting a native command's stderr (`2>&1`) throws `NativeCommandError` before you ever get to
inspect the text.

That parser is testable **without Azure** — run the regexes against the real error text from a failed
run, and add a negative case proving that a healthy message triggers no advice at all.

**Detect soft-delete, but never purge on your own initiative.** `az cognitiveservices account
list-deleted` finds the reserved name; then offer the three options — a different name, *Recover* in
the portal, or `az cognitiveservices account purge --name <n> --resource-group <rg> --location <loc>`
behind an explicit switch. Purging is irreversible, so it must never be the default recovery path.

**Don't fail on a difference that doesn't matter.** If the resource group already exists in another
region, warn and continue: its region is metadata, and the resources go where the template's
`location` parameter says.

## Rule of thumb

A subscription in which nothing has ever been created is a **different class of environment** than the
ones you tested on, and your prerequisites list only ever describes environments you have actually
met. When a new class shows up, walk the prerequisites in *every* document that describes the
deployment, not just the one you happen to have open.
