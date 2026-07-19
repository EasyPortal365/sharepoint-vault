---
title: SPFx in Teams — a personal app needs global deployment, not a root-site install
tags: [spfx, teams, deployment, app-catalog]
applies-to: SharePoint Online (SPFx 1.18+, Teams)
last-reviewed: 2026-07-16
---

# SPFx in Teams: a personal app needs **global deployment**, not a root-site install

> **Bottom line.** A Teams personal app hosts your web part on the tenant root site, so it needs global deployment (`skipFeatureDeployment: true` plus make available to all sites) and a `teams/` folder with correctly named icons — miss either and you get the `componentType` crash or no Teams app at all.
>
> **Ve zkratce.** Osobní Teams appka hostuje tvůj webpart na kořenovém webu tenantu, takže potřebuje globální nasazení (`skipFeatureDeployment: true` a zpřístupnění všem webům) a složku `teams/` se správně pojmenovanými ikonami – bez jednoho z toho dostaneš pád na `componentType`, nebo se Teams appka vůbec neobjeví.

## Symptom

Your SPFx web part works as a Teams *channel tab* but the *personal app* crashes on load:

> Cannot destructure property 'componentType' of 'this.context.webPartManifest'

Or more confusingly: one of your apps shows up in Teams and another — packaged seemingly the same way — doesn't appear in the Teams catalog at all.

## Cause

Two separate mechanisms, both convention-driven and neither obvious:

1. **Teams catalog publication** is triggered by a **`teams/` folder** in the project root containing two icons — no config entry anywhere:
   - `teams/<webPartComponentId>_color.png` — 192 × 192 tile,
   - `teams/<webPartComponentId>_outline.png` — 32 × 32 transparent white silhouette,
   - where `<webPartComponentId>` is the **web part's manifest `id`** — *not* `solution.id`. Wrong GUID → silently no Teams app.
   Plus `supportedHosts` must include `"TeamsTab"` / `"TeamsPersonalApp"`.
2. **A personal app hosts your SPFx code on the tenant root site** (`/_layouts/15/teamshostedapp.aspx`). The component must therefore be *available on the root site* — which is what **global deployment** does: `"skipFeatureDeployment": true` in `package-solution.json` **and** ticking *"Make this solution available to all sites in the organization"* at upload. Without it, the root site has no component registration → the `componentType` destructure crash. (Manually installing the app on the root site "fixes" it too — but that's a fragile workaround that also runs your provisioning on the tenant root. Don't.)

## Fix

For any solution meant to run as a Teams personal app:

```jsonc
// package-solution.json
"skipFeatureDeployment": true
```

- Upload → tick **make available to all sites**.
- Add the `teams/` folder with correctly named icons.
- Overlays/panels: Teams has no 48 px SharePoint suite bar — position them with a host-aware top offset (SP = 48, Teams = 0) instead of a hardcoded `top: 48`.

## Notes

- **Application Customizer widgets** (floating buttons etc.) have an extra twist: with `skipFeatureDeployment: true` the extension exists only at *tenant* scope — a manually created site `UserCustomAction` will **not** resolve it and the bundle never loads. The only working path is a **Tenant-Wide Extension** via `sharepoint/assets/ClientSideInstance.xml` (the `Properties` attribute is mandatory, may be empty). "Loaded tenant-wide" then just means the *code* loads everywhere — control actual visibility with runtime checks, defaulting to a silent no-op.
- With `skipFeatureDeployment: true`, Feature-framework provisioning XML is ignored — anything you provision must be **runtime code**.
- Diagnostic shortcut: opening `teamshostedapp.aspx` directly in a browser ending in **"No Parent window found"** is a *good* sign (component resolved, just no Teams shell). The `componentType` error is the bad one. Careful, though — outside Teams that page still **mounts the web part and runs `onInit`**, including any provisioning, against the tenant root. Not a playground.
- Re-uploading an updated `.sppkg`: don't re-tick "make available to all sites" a second time for tenant-wide extensions — you'll get duplicate entries in the Tenant Wide Extensions list.
- Teams clients (especially mobile) cache app icons hard — after changing them, the admin catalog updates quickly, devices may need a Teams cache clear.
