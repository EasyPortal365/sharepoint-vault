---
title: "SPFx adds Subresource Integrity to a script when the manifest path is { path, integrity }"
summary: A component manifest you pass to SPComponentLoader.loadComponent can carry an SRI hash per script resource as path { path, integrity }; SharePoint then emits script integrity crossorigin=anonymous and the browser refuses tampered bytes – pin the bootstrap the same way from the .sppkg manifest (immutable CDN file), because includeClientSideAssets puts it in ClientSideAssets that guests cannot read; plus three traps that make console tests lie (id+version cache, requirejs path cache, CRLF in the git working copy); on list and library views SharePoint applies none of it, so a ListView Command Set there runs unverified by the browser
tags: [spfx, security, sri, cdn, sp-loader, app-catalog, supply-chain, list-view-command-set]
applies-to: SPFx 1.2x web parts and extensions that load code at runtime from your own CDN with SPComponentLoader.loadComponent (measured on SPFx 1.22.2, SharePoint Online, November 2026)
last-reviewed: 2026-11-11
---

# SPFx adds Subresource Integrity to a script when the manifest path is `{ path, integrity }`

> **Bottom line.** If your web part fetches a component manifest from a CDN and calls `SPComponentLoader.loadComponent(manifest)`, whoever can write to that CDN runs code in every tenant. You can pin the exact bytes: in `loaderConfig.scriptResources`, give each `type: "path"` resource `path: { "path": "bundle_abc.js", "integrity": "sha384-…" }`. SharePoint then renders `<script integrity="sha384-…" crossorigin="anonymous">` and the browser refuses a bundle that does not match (`Script error`). Verify the manifest itself against a hash you trust before calling `loadComponent`. Keep that trust anchor **out of the CDN** by pinning the bootstrap the same way from the web part manifest in the `.sppkg`. Do not put the bootstrap file itself into the package: `ClientSideAssets` in the App Catalog is not readable by guests. When you test this in the console, use a unique manifest `version` and a unique bundle path per attempt, otherwise SPFx returns the module it already loaded and the test lies.
>
> **Ve zkratce.** Když web part načítá manifest komponenty z CDN přes `SPComponentLoader.loadComponent`, dej každému zdroji typu `path` tvar `{ path, integrity: "sha384-…" }`. SharePoint vloží `<script integrity crossorigin="anonymous">` a prohlížeč podvržený bundle nespustí. Manifest ověř proti otisku, kterému věříš. Kotvu důvěry drž mimo CDN: otiskem zavaděče v manifestu `.sppkg`, zavaděč sám zůstane na CDN pod neměnným jménem. `ClientSideAssets` v App Catalogu host nepřečte. V konzoli testuj s jiným `version` a jinou cestou bundlu pro každý pokus, jinak SPFx vrátí už načtený modul.

## Symptom

You built a "thin" SPFx package: the web part in the `.sppkg` only reads which version to run, downloads `<version>/manifest.json` from your CDN and calls `SPComponentLoader.loadComponent`. Nothing checks what it downloads. A stolen CDN deploy token, a hijacked DNS record or a compromised CI job is enough to run arbitrary code with the permissions of your app in every customer tenant.

While adding a check you also see confusing test results:

- a manifest with a deliberately wrong `integrity` still reports "loaded" in the console;
- a second `loadComponent` on the same page fails even though the manifest is now correct;
- the SHA-384 you computed from the file on disk does not match what the CDN serves.

## Cause

1. **SRI support is in sp-loader, but only for the object form of `path`.** When a script resource's `path` is an object, sp-loader resolves it to `{ path, integrity }` and SharePoint adds the `integrity` and `crossorigin="anonymous"` attributes to the script tag. A plain string `path` gets no integrity. On the tenant where this was measured the behaviour sits behind the SharePoint flight `SpfxSubresourceIntegrity` (60737), which was on. Check a customer tenant with `document.querySelectorAll('script[integrity]')` on a page that runs your component.
2. **SPFx caches components by `id` + `version`.** If every runtime build shares the manifest `version` (common when the version lives elsewhere), a second "version" on the same page resolves to the already-loaded module. The SRI check never runs.
3. **requirejs caches by script path.** A path that failed once stays failed on that page.
4. **CRLF in the working copy.** A GitHub Pages repository with `core.autocrlf=true` and no `.gitattributes` can have CRLF on disk while Pages serves the LF bytes stored in git. A hash computed from disk does not match the served file.

## Fix

**Inject integrity before loading** (the hashes come from a source you trust, not from the CDN response itself):

```ts
// manifest bytes were already checked against a trusted sha384 of the manifest file
for (const name of Object.keys(m.loaderConfig.scriptResources)) {
  const r = m.loaderConfig.scriptResources[name];
  if (r.type === 'component') continue;            // host-provided (react, sp-*): leave alone
  if (r.type !== 'path') throw new Error('unsupported resource ' + name);
  const p = typeof r.path === 'string' ? r.path : r.path.path;
  if (/^[a-z]+:|^\/\/|\.\./i.test(p)) throw new Error('bad path ' + name);
  r.path = { path: p, integrity: trustedSri[name] }; // 'sha384-…'
}
// every internalModuleBaseUrls entry must start with your own CDN folder
await SPComponentLoader.loadComponent(m);
```

**Where to keep the trust anchor.** A public key or hash list inside a bootstrap served from the same CDN is replaced together with the bootstrap. Pin the bootstrap itself from the `.sppkg`:

- After the build, copy the web part bundle to an **immutable, content-addressed name** on the CDN, for example `my-app-loader_<contenthash>.js`.
- Rewrite the web part manifest in `release/manifests` (it goes into the `.sppkg`) to `path: { path: "my-app-loader_<contenthash>.js", integrity: "sha384-…" }`. `package-solution` accepts the object form.
- The page now loads the bootstrap from the CDN with `integrity` taken from the App Catalog. A replaced bootstrap on the CDN does not run.
- Never overwrite or prune that file while any App Catalog may point at it.
- Sign the list of versions and hashes the bootstrap trusts (for example ECDSA P-256 with WebCrypto) and keep only the public key in the bootstrap.

**Do not move the bootstrap into the `.sppkg` if guests use the app.** `"includeClientSideAssets": true` works technically. In SPFx 1.22 (`spfx-heft-plugins`), `heft package-solution --production` then:

- packs **every file** in `release/assets` into `ClientSideAssets/`;
- rewrites `internalModuleBaseUrls` of **every manifest** in `release/manifests` to `HTTPS://SPCLIENTSIDEASSETLIBRARY/`.

SharePoint then serves the files from `/sites/appcatalog/ClientSideAssets/<solution id>/`. On the tenant where this was measured, that library had exactly two read grants:

- *Everyone except external users*;
- the read-only tenant admin role.

External (guest) users therefore cannot load the bootstrap, unless the tenant serves client-side assets through the Office 365 public CDN. A test under an admin account will not show it. Check `roleassignments` of the target library before you move code there.

**Hash what the CDN serves:** take the bytes from the git index (`git cat-file blob :<path>`), not from the working copy.

**Testing in the console without lying to yourself:**

- give each attempt its own manifest `version` and its own bundle path;
- reload the page after a failed attempt;
- `window._spComponentLoader` is available on modern pages.

**Testing the real bootstrap without touching the CDN:** if the bootstrap remembers the highest signed sequence number it has seen in `localStorage` (rollback protection), set that key to a huge number and reload. The bootstrap must refuse to start the app. Restore the key afterwards.

## Measured

SharePoint Online, SPFx 1.22.2, November 2026, our own tenant:

| Manifest given to `loadComponent` | Result |
|---|---|
| `path: "bundle.js"` (string) | script tag without `integrity` |
| `path: { path, integrity: <correct sha384> }` | tag with `integrity` + `crossorigin="anonymous"`, module loads |
| `path: { path, integrity: <wrong sha384> }`, unique `version` and path | `Script error`, module not loaded |
| wrong `integrity`, same `id` + `version` as an already loaded module | "loads" – the cached module is returned |

Same tenant, same day, by page type:

| Page | Script | `integrity` on the tag |
|---|---|---|
| Modern site page (`SitePages/*.aspx`) | web part entry bundle from a manifest with `{ path, integrity }` | yes |
| Modern site page | library loaded with `loadComponent` and `{ path, integrity }` | yes |
| List or library view (`Lists/*/AllItems.aspx`, `Forms/AllItems.aspx`) | tenant-wide ListView Command Set entry bundle (the manifest with sha384 is in the page HTML) | **no** |
| List or library view | library loaded by that command set with `loadComponent` and `{ path, integrity }` | **no** |

Both page types loaded the scripts through RequireJS (`data-requiremodule` on the tag). Lazy chunks of the library did get `integrity` on the list page too, because the library's own webpack runtime sets it, not SharePoint.

## Gotchas

- **List and library pages ignore manifest `integrity` (measured November 2026).** A ListView Command Set there runs unverified by the browser even with a correct `{ path, integrity }` manifest, and so does any library it loads with `loadComponent`. Other extension types on these pages were not measured — check them the same way before you rely on SRI. Measure on the page where the component actually runs: `[...document.scripts].filter(s => s.src.includes('<bundle>')).map(s => s.hasAttribute('integrity'))`. Use `hasAttribute`: the `integrity` property is an empty string when the attribute is missing. For the libraries your extension loads, you can check the bytes yourself first — `await fetch(url, { integrity, mode: 'cors' })` rejects on a mismatch — and refuse to call `loadComponent` when it fails. The extension's own entry bundle stays out of reach, because SharePoint loads it.

- **Lazy chunks are not covered.** The webpack runtime inside the verified entry bundle creates their script tags. Embed a chunk-hash map in the entry bundle (it is verified with it) and set `integrity` in the runtime, or avoid lazy chunks in code you load this way.
- **Without the flight there is no `integrity` attribute.** You are left with checking the manifest hash, and there is a window between that check and the browser fetching the bundle.
- **A bundle already on the page is reused.** If an older bootstrap on the same page loaded the same bundle path without `integrity`, SharePoint will not check it again.
- **Changing the bootstrap means a new `.sppkg`.** Keep it minimal and stable, and put everything else in the library on the CDN.
