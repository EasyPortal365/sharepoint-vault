---
title: A command set's commands are fixed in its manifest
tags: [spfx, command-set, extensions, deployment, app-catalog]
applies-to: SharePoint Online (SPFx ListView Command Set)
last-reviewed: 2026-09-24
---

# A command set's commands are fixed in its manifest

> **Bottom line.** A ListView Command Set declares its commands in the `items` of its manifest, and the manifest travels inside the `.sppkg`. At runtime you can change an existing command's `title`, `iconImageUrl`, `visible` and `disabled`, but you cannot add one — a new menu entry means a new package in every App Catalog. If the menu is going to grow, ship one entry that opens your own menu, or reserve hidden commands up front.
>
> **Ve zkratce.** ListView Command Set deklaruje své příkazy v `items` manifestu a manifest cestuje uvnitř `.sppkg`. Za běhu jde u existujícího příkazu měnit `title`, `iconImageUrl`, `visible` a `disabled`, ale přidat nový nejde – nová položka menu znamená nový balíček v každém App Catalogu. Když má menu růst, dej do něj jedinou položku, která otevře vlastní nabídku, nebo si skryté příkazy rezervuj předem.

## Symptom

Your extension already loads most of its logic from a CDN, so changes ship without touching the package. Then a new toolbar action is requested — and there is no way to make it appear. There is no command to look up with `tryGetCommand`, and nothing you do at runtime creates one.

## Cause

The commands are declared statically:

```json
"items": {
  "OPEN_TOOLS": {
    "title": { "default": "Tools" },
    "iconImageUrl": "https://cdn.contoso.com/tools/icon.svg",
    "type": "command"
  }
}
```

The SPFx reference for the `Command` class says so directly: commands "are initially defined in the extension's manifest file"; at runtime you get the matching object from `tryGetCommand` and customize its appearance by assigning its properties.

## Fix

Choose the shape before the first release:

- **One entry, your own menu.** A single command that opens a popover your code renders. Every future action is then data, not manifest.
- **Reserved slots.** Declare a few extra commands (`SLOT_A`, `SLOT_B`), keep them hidden (`visible = false`) until runtime configuration switches them on, and let the configuration supply their title and icon. Mind what Microsoft says about `title`: it is meant for minor changes such as "Submit these 3 items", because administrators are expected to understand what an extension does by reading its manifest. A slot stretches that intent — the manifest can only say that the slot exists, not what it will do — so give it an honest, generic title and tell admins that its actions come from configuration.

## Notes

- After you change `visible` outside `onListViewUpdated`, call `raiseOnChange()` — it re-reads the property but does not re-run `onListViewUpdated`. [Command set button never appears](command-set-button-never-appears.md) has the details, and the registration trap.
- The same holds for everything else the package carries: a new API permission request or a changed component manifest also needs a new `.sppkg`.
- [Command class (SPFx reference)](https://learn.microsoft.com/en-us/javascript/api/sp-listview-extensibility/command)
