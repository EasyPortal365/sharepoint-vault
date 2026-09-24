---
title: "`For license information please see …` leads to a 404 — the publish step left the bundle's `.LICENSE.txt` behind"
short-title: "A bundle's `.LICENSE.txt` never reaches your CDN"
summary: "webpack moves third-party license comments into `<bundle>.js.LICENSE.txt` and leaves only a pointer in the bundle; a publish step that copies `*.js`, or an allowlist `.gitignore`, ships the code without the texts MIT and BSD require. The file is build output: publish it next to its bundle, prune it with it, and make every build-vs-published check expect it"
tags: [tooling, webpack, spfx, cdn, licensing, release]
applies-to: webpack 5 production builds (measured on SPFx 1.22) published to your own CDN or static host
last-reviewed: 2026-09-25
---

# `For license information please see …` leads to a 404 — the publish step left the bundle's `.LICENSE.txt` behind

> **Bottom line.** webpack's production minifier moves the license comments of third-party packages into `<bundle>.js.LICENSE.txt` and leaves only `/*! For license information please see <bundle>.js.LICENSE.txt */` in the bundle. A publish step that copies only `*.js` — or an allowlist `.gitignore` that never lets the file through — ships your code without the license texts that MIT and BSD require to travel with it, and the pointer in every bundle leads to a 404 that no browser ever requests. The license file is part of the build output: publish it next to its bundle, prune it together with it, and make every "build vs. published" comparison expect it.
>
> **Ve zkratce.** Produkční minifikátor webpacku vyjme licenční komentáře balíčků třetích stran do `<bundle>.js.LICENSE.txt` a v bundlu nechá jen `/*! For license information please see <bundle>.js.LICENSE.txt */`. Publikace, která kopíruje jen `*.js` – nebo allowlist v `.gitignore`, který ten soubor nikdy nepustí – vydá kód bez licenčních textů, které MIT i BSD vyžadují šířit spolu s ním, a odkaz v každém bundlu vede na 404, o které si žádný prohlížeč nikdy neřekne. Licence je součást výstupu buildu: publikuj ji vedle jejího bundlu, prořezávej ji spolu s ním a každé porovnání „build vs. publikováno“ s ní musí počítat.

## Symptom

A production bundle starts with a comment like this:

```js
/*! For license information please see my-web-part_0a1b2c3d4e5f6a7b8c9d.js.LICENSE.txt */
```

The file it names sits next to the bundle in your build output. On your CDN, next to the published bundle, it is a 404. Nothing fails — the pointer is a comment, so no browser ever asks for the file — and nothing tells you: in our case 812 published bundles pointed to a license file that was not there.

## Cause

webpack 5 minifies a production build with Terser (`terser-webpack-plugin`, its built-in minimizer), and the plugin's `extractComments` option is on by default: the license comments leave the bundle for `<bundle>.js.LICENSE.txt`, and the bundle keeps only the pointer. An SPFx production build does the same. From then on, the license comments that the bundled packages carry in their code exist in the build output only in that file — and where they are MIT or BSD notices, shipping them with the code is a condition of the license (see References).

Between the build output and the host stood two gates, and either one is enough to drop the file:

1. **An allowlist `.gitignore`.** Our git-backed CDN ignores everything (`*`) and lists exceptions for what it serves. `*.js.LICENSE.txt` was not among them, so the files stayed on disk and never entered a commit — no error, no warning.
2. **A publish script that copies only what it knows.** Ours copied `*.js` and `manifest.json`, nothing else. It also compares a published version folder with the build by the exact set of files: a different file count means different content. So adding the licenses by hand is not a fix — the next publish reads the folder as foreign content and stops unless you allow an overwrite, and the check that verifies the pushed commit reports it as incomplete. The tool has to carry the licenses itself.

## Fix

Treat the license file as part of the build output, like the bundle it belongs to.

1. **Publish it next to its bundle** — wherever the bundle goes, a version folder or a pooled chunk folder alike. The pointer names the file relative to the bundle, so the two must sit side by side.
2. **Prune it together with its bundle.** Otherwise the licenses outlive a deleted version and get in the way of the next cleanup — see [`git rm -r` leaves the directory, so tools report a phantom version](git-rm-leaves-the-directory-so-tools-report-a-phantom-version.md).
3. **Make the publish tool expect it.** When a tool verifies the exact shape of its output — the set of files, their hashes — the tool is the only way a new file type reaches the host. A new companion file is therefore a change to the tool: the copy, the expected file set, the live check and the pruning. Not a manual upload, which the tool rightly rejects.
4. **Let it through the allowlist**, with a comment on why the file type is safe to publish: the files hold nothing but the license texts of npm packages. First clear out leftover `.LICENSE.txt` files in version folders you have already pruned, or keep the exception away from those folders until you have — once the pattern is allowed, the next `git add` of the folder commits the leftovers too, and pruned version folders come back.
5. **Verify on the live host, not on disk.** For a published bundle, both the bundle and the `.LICENSE.txt` it points to must answer 200. A file on disk proves nothing, because the allowlist filters it silently; after a publish, check that the pushed commit lists every new file (`git show --stat`, count included).

The live check follows the pointer the way a reader would:

```js
// check-license-link.mjs: node check-license-link.mjs <bundle URL> [<bundle URL> ...]
// Exit code 1 when a bundle does not load (non-2xx) or the license file it points to does not answer 200.
let failed = false;
for (const bundleUrl of process.argv.slice(2)) {
  const bundle = await fetch(bundleUrl);
  if (!bundle.ok) { console.log(`${bundle.status}  ${bundleUrl} (bundle)`); failed = true; continue; }
  const m = /\/\*! For license information please see (\S+) \*\//.exec(await bundle.text());
  if (!m) { console.log(`---  ${bundleUrl} (no license pointer)`); continue; }
  const licenseUrl = new URL(m[1], bundleUrl).href;
  const license = await fetch(licenseUrl, { method: 'HEAD' });
  console.log(`${license.status}  ${licenseUrl}`);
  if (license.status !== 200) failed = true;
}
process.exitCode = failed ? 1 : 0;
```

Run on Node 24 against a bundle whose license file is published (200), one whose license file is missing (404), a missing bundle and a bundle without a pointer.

## Notes

- **The allowlist is a trap for every new file type, not only this one.** For us this was the fourth file type it swallowed, after `.nojekyll`, brand assets and runtime metadata — [A GitHub Pages CDN without `.nojekyll` freezes on its last good build](github-pages-without-nojekyll-freezes-a-static-cdn.md).

## References

- [webpack: `extractComments` in the minimizer plugin documentation](https://webpack.js.org/plugins/minimizer-webpack-plugin/#extractcomments) — default `true`; `foo.js` gets `foo.js.LICENSE.txt`, and the default banner is `/*! For license information please see ${commentsFile} */`
- [The MIT License (Open Source Initiative)](https://opensource.org/license/mit) — "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."
- [The 3-Clause BSD License (Open Source Initiative)](https://opensource.org/license/bsd-3-clause) — "Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution."
