---
title: "A fixed `WEBSITE_CONTENTSHARE` in your template can break production on the first template redeploy after a slot swap"
short-title: "Fixed `WEBSITE_CONTENTSHARE` + slots = production back on the old share"
summary: "On a function app with deployment slots, `WEBSITE_CONTENTSHARE` isn't slot-sticky: a swap moves it together with the code. A template that pins the production value (say `toLower(appName)`) would point production back at its pre-swap share, which the staging slot now uses, the next time you deploy it. Leave the setting out of the template, as Microsoft recommends"
tags: [azure-functions, deployment-slots, bicep, arm, consumption-plan]
applies-to: "Azure Functions with deployment slots on the Consumption plan (Windows) or the Elastic Premium plan, which keep app content in an Azure Files share; deployed from Bicep or ARM"
last-reviewed: 2026-09-25
---

# A fixed `WEBSITE_CONTENTSHARE` can break production on the first template redeploy after a slot swap

> **Bottom line.** `WEBSITE_CONTENTSHARE` names the file share a function app runs its code from. It isn't a slot setting, so a swap moves it together with the code: after the swap, production holds the share the staging slot had. A template that pins the production value — for example `toLower(appName)` — would set it back on the next deployment of the template, and production would then run from the share with the old, possibly empty content. Don't set `WEBSITE_CONTENTSHARE` in the template; the platform generates a unique one for the app and each slot, and a template deployment without the setting left our slot's existing value unchanged.
>
> **Ve zkratce.** `WEBSITE_CONTENTSHARE` určuje sdílenou složku, ze které aplikace funkcí spouští kód. Není vázané na slot, takže se při prohození přesune spolu s kódem: produkce pak drží složku, kterou měl slot staging. Šablona, která hodnotu produkce pevně nastavuje – například `toLower(appName)` –, by ji při dalším nasazení šablony vrátila a produkce by běžela ze složky se starým, třeba prázdným obsahem. `WEBSITE_CONTENTSHARE` do šablony nepište; platforma vygeneruje jedinečnou hodnotu pro aplikaci i každý slot a nasazení šablony bez tohoto nastavení existující hodnotu našeho slotu nezměnilo.

## Symptom

Before the first swap everything looks right: production uses the share from the template, the staging slot uses a generated one. Microsoft's own quickstart for a Consumption function app with a deployment slot is built the same way — it pins `WEBSITE_CONTENTSHARE` to `toLower(functionAppName)` on the app and leaves it out on the slot.

After deploying to staging and swapping, the two slots show their settings swapped:

```
== production
Name                   Value                        SlotSetting
WEBSITE_CONTENTSHARE   my-func-5c8ebd71             False
== staging
Name                   Value                        SlotSetting
WEBSITE_CONTENTSHARE   my-func                      False
```

Production works — it now runs from the generated share that holds the new code — and the staging slot answers 503; it inherited the share that no code had ever been deployed to. The next run of the unchanged template would put `my-func` back on production. We changed the template before deploying it again, so this last step is inferred from the template writing the value, not observed.

## Cause

The content share isn't a slot setting, so it travels with the app content during a swap — and Microsoft's guidance is explicitly *not* to make it one. A template that writes a fixed value for the production app therefore works against the swap: applied after a swap, it would move production back to its pre-swap share.

## Fix

- Remove `WEBSITE_CONTENTSHARE` from the template for the app and its slots. The documentation calls leaving it out *the recommended approach* for ARM deployments: when it isn't set, a unique share is generated for the app and for each slot.
- An existing value survived template deployments without the setting — our staging slot kept its generated name. Check both slots again after the first deployment of the changed template.
- Some scenarios require a predefined value; the documentation names a storage account secured in a virtual network. There you must set a unique share name for the app and for each slot yourself, and create the shares in your deployment.

Check the state of both slots before and after you redeploy infrastructure:

```
az functionapp config appsettings list -g <rg> -n <app> --query "[?name=='WEBSITE_CONTENTSHARE'].{name:name, value:value, slotSetting:slotSetting}" -o table
az functionapp config appsettings list -g <rg> -n <app> --slot staging --query "[?name=='WEBSITE_CONTENTSHARE'].{name:name, value:value, slotSetting:slotSetting}" -o table
```

## Notes

- Source: [App settings reference for Azure Functions — WEBSITE_CONTENTSHARE](https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings#website_contentshare).
- Related: [Unanchored `.funcignore` patterns strip your dependencies](funcignore-unanchored-pattern-strips-node-modules.md) — another surprise on the same first deployment.
