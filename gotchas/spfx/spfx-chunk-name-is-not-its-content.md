---
title: An SPFx chunk's file name is not its content — realContentHash is off
short-title: An SPFx chunk's file name is not its content
summary: "SPFx builds with `realContentHash: false`, so a byte-identical chunk can get a new name (measured) and nothing rules out the reverse; deduplicate by bytes or git blob and never overwrite a published file"
tags: [spfx, webpack, cdn, caching, deployment, git]
applies-to: SPFx production builds (verified on SPFx 1.22.2, @microsoft/spfx-heft-plugins); anyone sharing or deduplicating bundles across versions
last-reviewed: 2026-09-24
---

# An SPFx chunk's file name is not its content — `realContentHash` is off

> **Bottom line.** SPFx builds with webpack's `optimization.realContentHash` switched off, so the hash in a chunk's file name is not recomputed from the bytes that ship. Measured: a lazy chunk that was byte-for-byte identical in two consecutive builds came out under a different name — and nothing in the build rules out the reverse. If you share or deduplicate chunks across versions (your own CDN, a cache keyed by file name), compare content — a hash of the bytes or the git blob — and never overwrite a file that is already published with different bytes.
>
> **Ve zkratce.** SPFx staví s vypnutým `optimization.realContentHash` webpacku, takže hash ve jméně chunku se nepřepočítává z bajtů, které odcházejí ven. Změřeno: líně načítaný chunk, bajtově shodný ve dvou po sobě jdoucích buildech, vyšel pod jiným jménem – a opačný směr build nevylučuje ničím. Kdo chunky mezi verzemi sdílí nebo deduplikuje (vlastní CDN, cache podle jména souboru), musí porovnávat obsah – hash bajtů nebo git blob – a soubor, který už je publikovaný, nikdy nepřepisovat jinými bajty.

## Symptom

You keep one copy of each lazy chunk across releases — a shared folder on your CDN — and decide what is new by file name, because the name carries a content hash. Then:

- A chunk you know has not changed turns up under a new name in every build, so the shared folder keeps growing. Measured on one app: a 60 kB chunk, byte-identical between two releases, was renamed from `chunk.294_7e16…js` to `chunk.294_54c1…js`.
- The dangerous direction is the one you cannot see: nothing guarantees that a toolchain change (a new minifier version, say) will not produce *different* bytes under a name that already exists. A name-based deduplication then either skips the new file — the new version runs old code — or overwrites the old one, and older versions start loading code they were never built with.

## Cause

The webpack configuration that SPFx generates switches the setting off explicitly (`@microsoft/spfx-heft-plugins` 1.22.2, `WebpackConfigurationGenerator.js`):

```js
optimization: {
  // TODO: turn this on when webpack5-localization-plugin can suppress RealHashPlugin re-processing files.
  realContentHash: false,
  …
}
```

while chunk names still use the `[contenthash]` template. Webpack's own documentation spells out the consequence: with `realContentHash` set to `false`, "internal data is used to calculate the hash and it can change when assets are identical". In production mode webpack would default to `true`; SPFx overrides it.

## Fix

- **Deduplicate by content, not by name.** Compare a hash of the bytes, or — on a git-backed host — the blob that is published (`git rev-parse HEAD:<path>`) with the blob the new file would become (`git hash-object --path <path> <new-file>`).
- **Never overwrite a published file with different bytes.** If a name already exists with other content, publish that release the old, self-contained way (its own folder) instead. A duplicate costs a little space; an overwrite breaks every version that still points at the file.
- **Compare blobs, not the SHA of the file on disk.** With `core.autocrlf=true`, a file restored by `git checkout` sits on disk with CRLF line endings while the commit — and therefore the published site — has LF. A disk hash then reports "different" for identical content; `git hash-object --path` applies the same conversion a commit would.

## Notes

- The shared folder has to live where the library bundle is loaded from: the bundle sets webpack's public path from the address of its own script, so chunks are requested next to it — see [A library component loaded from your own manifest fetches its lazy chunks from that manifest's folder](library-component-lazy-chunks-load-from-the-manifest-folder.md).
- Pruning shared chunks needs reference counting from every version that stays, not a date: [A retention window computed from git history deletes the file you overwrite in place](../tooling/retention-by-git-history-deletes-files-overwritten-in-place.md) · [CDN pruning deleted the extension bundle the .sppkg still referenced](cdn-pruning-deletes-extension-bundles-the-sppkg-still-references.md).
- [`optimization.realContentHash` (webpack documentation)](https://webpack.js.org/configuration/optimization/#optimizationrealcontenthash)
- **A vendor chunk can also change for a reason unrelated to the vendor code.** Two builds of the same app produced a 393,107-byte chunk of a document-conversion library under two names; the files had the same length and differed in exactly one place — a webpack module id (`3665:` vs `6046:`). One build ran from a git worktree whose `node_modules` was a junction to the main checkout, and its sources were a few commits apart. Content-based deduplication rightly stored both, so the shared folder grew by the size of a library that had not changed. We did not isolate the cause; production builds derive deterministic module ids from module paths and resolve collisions against the whole module set, and both differed. Build releases from one checkout where you can, and expect vendor chunks to be duplicated when you don't.
