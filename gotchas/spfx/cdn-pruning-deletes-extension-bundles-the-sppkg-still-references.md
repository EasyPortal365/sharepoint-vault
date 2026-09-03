---
title: CDN pruning deleted the extension bundle the deployed .sppkg still referenced
tags: [spfx, cdn, app-catalog, application-customizer, command-set, deployment, retention]
applies-to: SharePoint Online, SPFx with includeClientSideAssets:false
last-reviewed: 2026-09-03
---

# CDN pruning deleted the extension bundle the deployed `.sppkg` still referenced

> **Bottom line.** With `includeClientSideAssets: false` the package in the App Catalog pins a *content-hashed* file name for every component. A web part can be routed through a stable loader file, but application customizers and command sets usually are not — so a retention rule such as "keep the 10 newest releases" eventually evicts exactly the hash the catalog still asks for, and the extension silently 404s on every page. Treat extension bundles as a permanent contract: never prune them by age, or give them stable names.
>
> **Ve zkratce.** Při `includeClientSideAssets: false` ukazuje balíček v App Catalogu na *hashované* jméno každé komponenty. Webpart jde obejít stabilním loaderem, application customizer a command set obvykle ne – retence „drž 10 nejnovějších releasů" proto jednou vyhodí přesně ten hash, který katalog pořád žádá, a rozšíření tiše vrací 404 na každé stránce. Bundly rozšíření ber jako trvalý kontrakt: nikdy je nemaž podle stáří, nebo jim dej stabilní jména.

## Symptom

An application customizer (a floating assistant widget) and a library command set stopped rendering on every page of the hub site. Nothing else changed: the web part of the same solution kept working, the package in the App Catalog was untouched, and the tenant had not been updated for weeks.

The page's own network log told the story in ten seconds:

```js
performance.getEntriesByType('resource')
  .filter(r => r.name.indexOf('cdn.contoso.com/assistant/') !== -1)
  .map(r => ({ url: r.name, status: r.responseStatus }));
// assistant/assistant-widget_e2d1e9867983f71c6e26.js      404
// assistant/assistant-docs-command_d00a4e6597279b86a43f.js 404
```

Both files had existed on the CDN. `git log --diff-filter=AD -- <file>` in the CDN repository showed each one added by a release two weeks earlier and **deleted by a routine retention prune three days before the report**. The failure had been live for three days; nobody opens the widget after every release, and the post-release smoke test looks at the app page, not at a random library view.

## Cause

1. The solution ships its assets from a CDN (`includeClientSideAssets: false`, `cdnBasePath`). The manifest inside the `.sppkg` therefore contains the **exact content-hashed file names** of the build that was uploaded to the catalog.
2. The web part is served through a **stable** file (`assistant-loader.js`, overwritten in place on each release), so its hash never leaves the catalog's view. The customizer and the command set are ordinary components: their hashed bundles land in the CDN root and are referenced **directly**.
3. The prune tool keeps the stable root files plus everything reachable from the *N newest* releases. The catalog's hash is not visible from the CDN — it lives in each customer's App Catalog — and after N further builds it falls out of the window.

The web part survived only because of a rule written for the loader ("a root file without a content hash is a contract, keep it always"). Nothing marked the hashed extension bundles as a contract too.

## Fix (minutes)

Restore the files from git history and push; GitHub Pages redeploys in about a minute:

```bash
# which commit removed it, and which one added it
git log --all --format="%h %ad %s" --date=short --diff-filter=AD -- assistant/assistant-widget_e2d1e9867983f71c6e26.js
# restore from the parent of the deleting commit
git checkout <deleting-commit>^ -- assistant/assistant-widget_e2d1e9867983f71c6e26.js
```

Before pushing, check the chunks the restored bundle lazy-loads. Webpack builds chunk URLs from two maps, so the full file name is often not in the bundle — search for bare 20-hex hashes and make sure each `chunk.*_<hash>.js` still exists in the root; restore missing ones from the same commit. A missing chunk fails only when the user opens that feature, which is the worst kind of silent.

No new `.sppkg` is needed: the catalog is right, the CDN was wrong.

## Prevention

- **Protect extension bundles by name pattern, forever.** Give the prune policy a list of name patterns (`-widget_`, `-command_`, `-customizer_`) and treat every matching root file like a stable contract. They are small (tens of KB); the cost of keeping a dozen old ones is nothing next to a broken customizer at every customer. Old ones can be removed manually **after** a new package that points elsewhere has been uploaded everywhere — and only then.
- **Fail closed on the policy.** The orchestrating script must refuse to run when the policy lacks the patterns field. A missing setting that defaults to "no protection" is how the original bug happened in the first place.
- **Prove the rule with a synthetic run and its counterexample.** Build a throw-away mini-CDN in a temp folder with the extension bundle in the *oldest* commit, outside the retention window, and run the real prune script twice: with the pattern it must survive, without it it must be deleted. A test that cannot fail proves nothing.
- **Better long term: stabilize extension bundles too.** The same post-build step that copies the web part bundle to `assistant-loader.js` can copy the customizer to `assistant-widget.js` and the command set to `assistant-docs-command.js`; point the manifests at the stable names and re-upload the package once. From then on the catalog never references a hash.
- **"It stopped working" is not "it broke today".** The deleting commit's date is the outage start; ask for it before hunting in today's changes.

## Related

- [CDN-hosted bundle still needs a new `.sppkg`](cdn-hosted-bundle-still-needs-new-sppkg.md) — the other half of the same contract: the manifest pins a hashed file name, so a new bundle needs a new package unless a stable loader sits in between.
- [Ship SPFx updates without re-uploading `.sppkg`](../../guides/runtime-app-versions-without-sppkg-reuploads.md) — the stable-loader pattern this gotcha assumes for the web part.
