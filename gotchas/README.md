# 💥 Gotchas

Real-world SharePoint traps, documented as **symptom → cause → fix** — so a problem that cost us hours costs you minutes.

Every article carries frontmatter with `tags` and `applies-to`, so repo search gets you there fast (try `path:gotchas threshold`).

## Index

### rest-api/

| Gotcha | TL;DR |
|---|---|
| [Get lists by URL, not by title](rest-api/get-list-by-url-not-by-title.md) | `getbytitle()` breaks the moment someone renames a list — resolve by URL instead |
| [Search REST needs `odata-version: 3.0`](rest-api/search-api-needs-odata-version-3.md) | The header that turns mysterious search 500s into working queries |
| [DateTime: write full ISO, derive days locally](rest-api/datetime-write-full-iso-read-local-day.md) | No-timezone writes 400; UTC reads shift the day — `toISOString()` in, local getters out |
| [`__metadata` body requires verbose](rest-api/metadata-body-requires-verbose.md) | Old-tutorial payloads 400 in modern clients — drop the hint or go verbose on both headers |
| [File upload 406 needs verbose](rest-api/file-upload-406-needs-verbose.md) | `/Files/add` is a classic endpoint — `odata=verbose` + `OData-Version: 3.0`, plus the empty-filename mobile trap |
| [Apostrophes in OData literals](rest-api/odata-string-literals-and-apostrophes.md) | `encodeURIComponent` leaves `'` alone — double it, or O'Brien breaks your filters |
| [Choice fields accept any value](rest-api/choice-fields-accept-any-value.md) | Validation is a form-only illusion — REST writes anything; enforce vocabulary yourself |
| [Lookup fields need `$expand`](rest-api/lookup-fields-need-expand.md) | Relations, not values — read via `$expand` + projected fields, write via `<Name>Id`; mind the ~12-lookup limit |
| [File size needs `$expand=File`](rest-api/file-size-needs-expand-file.md) | `File_x0020_Size` is computed and 400s in `$select` — use `File/Length` + `File/UIVersionLabel` |
| [Create a modern page via REST (3-step)](rest-api/create-modern-page-via-rest-sitepages.md) | `CanvasContent1` won't stick on create — it's create → SavePageAsDraft → Publish, and the canvas is JSON, not HTML |
| [`$filter` on multi-value person fields 400s](rest-api/filter-on-multivalue-person-field-400.md) | UserMulti projections don't filter server-side — fall back to client filtering, but only on HTTP 400 |
| [Silent fallbacks poison destructive writes](rest-api/silent-fallbacks-poison-destructive-writes.md) | `catch → []` is great for rendering and catastrophic for delete-then-insert syncs — offer strict and safe reads |

### lists/

| Gotcha | TL;DR |
|---|---|
| [The 5,000-item view threshold](lists/list-view-threshold-and-indexes.md) | It's about scanned rows, not returned rows — index early, filter indexed-first, page always |

### spfx/

| Gotcha | TL;DR |
|---|---|
| [The ES2015 `lib` trap](spfx/es2015-lib-forbidden-apis.md) | Why `padStart` and friends fail the build (TS2550), and the safe equivalents |
| [SPA router hijacks anchor clicks](spfx/spa-router-hijacks-anchor-clicks.md) | On published pages, `<a href>` navigates before React `onClick` runs — use buttons for in-app actions |
| [Third-party CSS breaks webpack](spfx/css-url-assets-break-webpack.md) | `url(images/...)` without `./` kills the build (Leaflet et al.) — inject a `<link>` instead of importing |
| [Minified React errors cheatsheet](spfx/react-minified-errors-cheatsheet.md) | #310/#300 = hooks after early returns, #31 = object as child, #185 = setState loop — decoded for SPFx |
| [People search endpoints that work](spfx/people-search-endpoints-that-work.md) | `clientPeoplePickerSearchUser` comes back empty, `siteusers` is not a directory — use the SP Search People source + `ensureuser` |
| [Fixed dropdowns in transformed panels](spfx/fixed-dropdowns-in-transformed-panels.md) | `transform` makes ancestors the containing block even for `position: fixed` — portal your dropdowns to `document.body` |
| [`SP.WebProxy` is add-in-only](spfx/webproxy-is-add-in-only.md) | There is no SharePoint-native CORS proxy for SPFx — 403 "without an app context", hidden inside an HTTP 200 |
| [Teams personal app needs global deploy](spfx/teams-personal-app-needs-global-deploy.md) | `skipFeatureDeployment: true` + "all sites", or the root-hosted app crashes on `componentType`; plus the `teams/` icon-folder convention |
| [Teams mobile webview renders desktop width](spfx/teams-mobile-webview-renders-desktop-width.md) | ~980px layout you can't reproduce in a browser — fix the viewport meta in Teams, then debug breakpoints |
| [Centered flex clips on mobile](spfx/centered-flex-clips-on-mobile.md) | `justify-content:center` + overflow = content cut off above the scroll — use flex "springs" instead |
| [JSX attributes and smart quotes](spfx/jsx-attributes-and-smart-quotes.md) | Typographic quotes in `"…"` attributes = TS1003 — wrap localized strings as `{'…'}` |
| [Portaled overlays miss your CSS reset](spfx/portaled-overlays-miss-your-css-reset.md) | `createPortal` to `body` escapes `.app-root` — fields inherit `content-box`, overflow by 26px, panel grows a scrollbar |

### app-catalog/

| Gotcha | TL;DR |
|---|---|
| [Three `.sppkg` packaging pitfalls](app-catalog/sppkg-packaging-pitfalls.md) | ASCII-only solution name, icon exactly 96×96, and why the Publisher column stays empty |

### graph/

| Gotcha | TL;DR |
|---|---|
| [`/me/sendMail`: From is always the signed-in user](graph/sendmail-from-is-the-signed-in-user.md) | Delegated `Mail.Send` can't impersonate — configurable "sender" settings should govern Reply-To |
| [Purview Audit Query API is async](graph/purview-audit-query-api-is-async.md) | Queries run for an hour+ — attach to the last succeeded one, create in the background; v1.0 may 404 where beta works |
| [Office files: property demotion changes the hash](graph/office-files-property-demotion.md) | A metadata PATCH rewrites bytes inside docx/xlsx — `cTag` and even content hashes lie; key change detection on `lastModifiedBy` |
| [Usage reports are CORS-blocked in the browser](graph/usage-reports-cors-blocked-in-browser.md) | Reports 302 to a host without CORS headers — fetch server-side; browse-time inventory = SP Search + `/_api/site/usage` |
| [Tenant-wide enumeration is app-only](graph/tenant-wide-enumeration-is-app-only.md) | `getAllSites` & friends reject delegated tokens with a silent 403 — check the Permissions table *before* building |
| [`MSGraphClient` calls bypass DevTools Network](graph/msgraphclient-calls-bypass-devtools-network.md) | SPFx Graph traffic doesn't show in the Network tab — diagnose with `performance` entries, `currentuser`, the DOM, and the user's own response |
| [`PATCH /me`: directory vs profile fields](graph/patch-me-directory-vs-profile-fields.md) | Mixing `jobTitle` with `aboutMe` fails the whole request — two PATCHes, profile one best-effort |

### azure-functions/

The standard server-side companion of an SPFx solution — and its own set of traps.

| Gotcha | TL;DR |
|---|---|
| [Windows zip deploy breaks the running app](azure-functions/windows-zip-deploy-breaks-running-app.md) | Copying onto a live `wwwroot` corrupts files → whole app 503 — re-run the deploy (not restart); prevent with `WEBSITE_RUN_FROM_PACKAGE=1` |
| [Rate limit counts the capability probe](azure-functions/rate-limit-counts-capability-probe-corporate-nat.md) | Per-IP limits behind corporate NAT = per-company limits — metered "what can you do?" probes silently kill the feature's UI |

### search/

| Gotcha | TL;DR |
|---|---|
| [ViewsX properties sort only by `ViewsLifeTime`](search/viewsx-properties-sort-only-by-viewslifetime.md) | Windowed view counts select fine but don't sort — one lifetime-sorted query, re-rank client-side |
| [Compare SharePoint paths decode-first](search/compare-sharepoint-paths-decode-first.md) | Browser URLs are %-encoded, search `Path` is decoded — normalize both, then boundary-aware prefix match |
| [Don't trust the parsed-file-types table: SPO does index `.md`](search/md-is-fulltext-indexed-despite-the-docs.md) | The official table omits Markdown, yet live SPO full-text indexes it — probe capability tables before you architect around them |
| [Graph Search returns 0 hits — you passed the question as the `queryString`](search/graph-search-raw-question-returns-nothing.md) | A question isn't a query and "what's new" isn't a search — translate to keywords, use `*` + the default date sort, and only documented per-entity KQL |

### powershell/

| Gotcha | TL;DR |
|---|---|
| [PS 5.1 `Get-Content` mangles UTF-8](powershell/get-content-mangles-utf8.md) | ANSI-default reads double-encode diacritics (`á`→`Ã¡`) — go through `System.IO.File` with BOM-less `UTF8Encoding` |
| [Smart quotes are string delimiters](powershell/smart-quotes-are-string-delimiters.md) | PS parses `„` and `"` like ASCII `"` — localized text belongs in single-quoted here-strings |

### security/

| Gotcha | TL;DR |
|---|---|
| [Stored XSS via list content](security/stored-xss-from-list-content.md) | React doesn't block `javascript:` hrefs or sanitize SVG — allowlist `safeHref` with C0-strip at every sink |

### tooling/

| Gotcha | TL;DR |
|---|---|
| [Git Bash mangles backslashes for native exes](tooling/git-bash-mangles-backslashes-for-native-exes.md) | `[\\/]` arrives as `[/]` — Windows-path regexes silently under-match; use `.{1,4}` or run from PowerShell |
| [GitHub Pages certificate stuck](tooling/github-pages-certificate-stuck.md) | Domain added before DNS existed → cert never arrives — remove & re-add the domain to restart provisioning |

## Writing your own

Use the skeleton in [CONTRIBUTING](../CONTRIBUTING.md) — one trap per file, error messages verbatim, code that fixes it.
