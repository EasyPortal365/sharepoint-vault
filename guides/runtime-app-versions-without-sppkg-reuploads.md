---
title: "Ship SPFx app updates without re-uploading .sppkg: a loader webpart + Library component from your CDN"
tags: [spfx, deployment, app-catalog, cdn, versioning, library-component, spcomponentloader, rollback]
applies-to: SharePoint Online (SPFx 1.18+; verified on 1.22.2)
last-reviewed: 2026-08-01
---

# Ship SPFx app updates without re-uploading .sppkg: a loader webpart + Library component from your CDN

> **Bottom line.** With `includeClientSideAssets:false` your bundles already live on a CDN — but the component manifest **inside the .sppkg** pins a content-hashed bundle path, so every release still means a new .sppkg in every tenant's App Catalog. Split the app: the webpart becomes a tiny permanent **loader** (stable bundle name, patched into the manifest post-build), and the whole app moves into an **SPFx Library component** whose manifest + bundle live in a **versioned CDN folder**. At runtime the loader picks a version (admin pin from a SharePoint list, else newest from `releases.json`), fetches `/<version>/manifest.json` and calls `SPComponentLoader.loadComponent(manifest)`. New release = upload a folder to the CDN. The .sppkg is uploaded once.
>
> **Ve zkratce.** I s `includeClientSideAssets:false` manifest UVNITŘ .sppkg ukazuje na content-hashovaný bundle — každá verze znamená nový balíček v App Catalogu každého tenantu. Rozděl aplikaci: webpart = trvalý **loader** (stabilní jméno bundlu, patchnuté do manifestu po buildu), celá appka = **Library komponenta** ve verzovaném adresáři CDN. Loader za běhu zvolí verzi (pin správce ze SP listu, jinak nejnovější z `releases.json`), stáhne `/<verze>/manifest.json` a zavolá `SPComponentLoader.loadComponent(manifest)`. Nová verze = nahrát adresář na CDN; .sppkg se nahrává jednou.

## Why a new .sppkg was needed at all

The WebPart XML inside the .sppkg embeds the component manifest, including:

```json
"loaderConfig": {
  "internalModuleBaseUrls": ["https://cdn.contoso.com/app/"],
  "entryModuleId": "contoso-app-web-part",
  "scriptResources": {
    "contoso-app-web-part": { "type": "path", "path": "contoso-app-web-part_cf958e44385cd9a6b086.js" }
  }
}
```

That `_cf958e…` hash changes with every build. A tenant running an old .sppkg keeps requesting the old file no matter what you upload to the CDN.

## The pattern

1. **Two bundles in one project** (`config/config.json`): the existing webpart bundle and a new **Library component** (`componentType: "Library"`, own GUID). Move *everything* the webpart did (init, services, React tree) into the library's `index.ts`, exporting a small contract:

```ts
export async function mount(el: HTMLElement, host: { context: unknown; properties: IProps }): Promise<void> { /* whole app */ }
export function update(el: HTMLElement, host: …): void   { /* re-render on property changes */ }
export function unmount(el: HTMLElement): void            { /* ReactDom.unmountComponentAtNode */ }
```

   The library resolves `react`, `@microsoft/sp-http` etc. from the SPFx runtime — no duplication. **Never break this contract**; the deployed loader is permanent. New fields must be optional.

2. **Webpart becomes the loader** (~8 KB): resolve version → fetch manifest → load → mount. Keep the property pane here.

```ts
const manifest = await (await fetch(CDN + version + '/manifest.json', { cache: 'no-cache' })).json();
const app = await SPComponentLoader.loadComponent<IAppModule>(manifest as IClientSideComponentManifest);
await app.mount(this.domElement, { context: this.context, properties: this.properties });
```

   `SPComponentLoader.loadComponent(manifest)` is public API in `@microsoft/sp-loader` and works with a manifest fetched from anywhere — it is the same JSON the .sppkg would have carried.

3. **Post-build stabilization** (a Node script between `heft build` and `heft package-solution`):
   - copy the webpart bundle to a **stable name** (`contoso-app-loader.js`) and rewrite `scriptResources[...].path` in its manifest → the .sppkg no longer references a hash;
   - **move** the library manifest out of `release/manifests/` (so package-solution does not embed it) into a staging folder, rewriting its `internalModuleBaseUrls` to the **versioned** CDN folder (`https://cdn.contoso.com/app/1.4.0/`).

4. **CDN layout & release**:

```
app/contoso-app-loader.js     stable loader (overwrite = loader update for everyone, rare)
app/releases.json             [{"version":"1.4.0","date":"2026-08-01"}, …] newest first, keep ~10
app/1.4.0/                    library bundle (hash in name is fine here) + manifest.json
app/*.js                      legacy hashed bundles for tenants still on the old-style .sppkg — never delete
```

   Retention: delete only version folders that dropped out of `releases.json` (mark & sweep). If a tenant is pinned to a pruned version, the loader falls back to newest and tells the app via a flag — never a blank page.

5. **Version resolution in the loader** (in order): localStorage cache (short TTL) → admin **pin** stored in a SharePoint list row (`Title='runtime'`, JSON `{activeVersion}`) → newest from `releases.json`. Validate the version string (`/^\d+(\.\d+){1,3}$/`) — it goes into a URL. The pin row lives in the app's own settings list, so it applies to every user of that site; your settings UI writes it (activate newer / roll back older) and must clear the loader's localStorage key (shared constant = contract).

6. **Versioning**: `package-solution.json` stays at a fixed marketing version (e.g. `10.0.0.0`). The real app version moves to its own file (e.g. `config/app-version.json`) consumed by your version-sync, the stabilizer and the publisher.

## What still requires a new .sppkg

- new `webApiPermissionRequests` (Graph scopes need admin consent from the package),
- webpart manifest changes (new properties, `supportedHosts`),
- Teams manifest / icons.

These are rare; bump the package version (10.1…) when they happen.

## Pitfalls we hit so you don't

- **Offer actions based on the *running* version, not the *target* one.** The client may serve an older cached version for a while; comparing against "what would load next" hid the Activate button in our first live test.
- **Allowlist `.gitignore` on the CDN repo silently drops new file types.** If your CDN repo ignores `*` and whitelists `!*.js`, your `releases.json` and `manifest.json` never reach the remote — add exceptions first, then verify the pushed commit lists *all* new files.
- Windows PowerShell 5.1 only: `@(Get-Content x | ConvertFrom-Json)` does **not** unwrap the parsed array — see the companion gotcha before you script `releases.json` updates.
- Loader status texts: use `textContent` with constant strings only — no data reaches the DOM before the app loads.
