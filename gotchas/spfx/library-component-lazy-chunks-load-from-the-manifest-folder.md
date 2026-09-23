---
title: A library component loaded from your own manifest fetches its lazy chunks from that manifest's folder
tags: [spfx, library-component, cdn, webpack, spcomponentloader, deployment]
applies-to: SharePoint Online, SPFx library components loaded with SPComponentLoader.loadComponent (verified on SPFx 1.22.2)
last-reviewed: 2026-09-24
---

# A library component loaded from your own manifest fetches its lazy chunks from that manifest's folder

> **Bottom line.** `SPComponentLoader.loadComponent(manifest)` loads a component from any manifest you hand it, and webpack inside that component resolves every lazy chunk against the folder its bundle was loaded from — the manifest's `internalModuleBaseUrls`. Publish the bundle and its manifest to a folder without the `chunk.*` files, and the app starts fine — then every `import()`-ed feature 404s on first use, which a smoke test that only opens the app never exercises. Copy all chunks next to the bundle, and make the smoke test open a lazy feature.
>
> **Ve zkratce.** `SPComponentLoader.loadComponent(manifest)` načte komponentu z jakéhokoli manifestu, který mu předáš, a webpack uvnitř ní skládá adresu každého líně načítaného chunku ze složky, odkud se načetl její bundle – tedy z `internalModuleBaseUrls` toho manifestu. Když do složky publikuješ bundle s manifestem bez souborů `chunk.*`, appka naběhne normálně – a pak každá funkce za `import()` při prvním použití vrátí 404, což smoke test, který jen otevře appku, nikdy nevyzkouší. Zkopíruj všechny chunky k bundlu a ať smoke test otevře i líně načítanou funkci.

## Symptom

The component renders. Charts, spreadsheet import, document preview — anything behind a dynamic `import()` — fails the first time a user opens it:

```
GET https://cdn.contoso.com/app/1.4.0/chunk.xlsx_4c1e0d6a9b7f3e2a1c5d.js   404
```

The chunk exists — in the build's flat asset folder, not in the folder the manifest points at.

## Cause

The SPFx loader requests the bundle from the manifest's `internalModuleBaseUrls`, and the bundle sets webpack's public path from the address of its own script (SPFx adds `SetPublicPathCurrentScriptPlugin` to the build). Chunk URLs are built from that public path — so point a manifest at a new folder and the chunks are expected there too. A packaging step that moves only the entry bundle and its manifest leaves them behind — in our case some eighty chunks (diagram rendering, spreadsheets, document conversion) that nothing at startup asked for.

## Fix

- Copy **every** `chunk.*` from the build's asset folder into the folder the manifest names — copy, not move, if the flat folder still serves other components.
- Add the copy step even to components that have no chunks today; the first future `import()` would otherwise break silently.
- Make the post-release check open one lazy-loaded feature, not just the app.

## Notes

- Webpack composes a chunk's file name from two maps at runtime, so the full `chunk.<name>_<hash>.js` is often not present as a string in the bundle. When you check which chunks a bundle needs, search for the bare 20-hex hash.
- Tempted to keep one shared copy of each chunk across versions? Decide by content, not by name: [An SPFx chunk's file name is not its content](spfx-chunk-name-is-not-its-content.md).
- The same "breaks only on first use" shape bites CDN clean-ups: [CDN pruning deleted the extension bundle the .sppkg still referenced](cdn-pruning-deletes-extension-bundles-the-sppkg-still-references.md).
- `loadComponent` is part of the public `@microsoft/sp-loader` API: [SPComponentLoader class](https://learn.microsoft.com/en-us/javascript/api/sp-loader/spcomponentloader).
