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
| [`GetStorageEntity` returns 200 for a missing key](rest-api/getstorageentity-returns-200-for-missing-key.md) | Unset tenant property answers `200 {"odata.null":true}` — status codes cannot tell "unset" from "failed"; writing needs Tenant Admin |
| [Silent read failure drives delete-all](rest-api/silent-read-failure-drives-delete-all.md) | An empty array from a throttled read is indistinguishable from an empty source — reconciliation then deletes everything |
| [App page properties are not in CanvasContent1](rest-api/app-page-webpart-properties-not-in-canvascontent.md) | Single-part app pages keep web part config elsewhere — the property pane and the runtime tree are the truth |
| [Silent fallbacks poison destructive writes](rest-api/silent-fallbacks-poison-destructive-writes.md) | `catch → []` is great for rendering and catastrophic for delete-then-insert syncs — offer strict and safe reads |
| [Provisioning skips schema changes to existing fields](rest-api/provisioning-skips-schema-changes-to-existing-fields.md) | "Create field if missing" never updates an existing field — a new Choice value in your manifest no-ops on deployed sites; reconcile with a verbose `SP.FieldChoice` MERGE |
| [`X-RequestDigest` expires mid-session](rest-api/request-digest-expires-mid-session.md) | Writes 403 "security validation is invalid" on a long-open page — the page digest times out (~30 min); fetch a fresh one from `/_api/contextinfo` per write |
| [Don't cache a throttled permission probe](rest-api/dont-cache-a-throttled-permission-probe.md) | A 429/403 on `currentuser/groups` resolves to the lowest role — cache it and the user is stuck read-only for the TTL; only persist a confirmed (200) result |
| [Telling a list's own columns from inherited ones](rest-api/which-columns-are-the-librarys-own.md) | Snapshotting a list schema: filtering on `Hidden`/`ReadOnlyField` still leaves ~40 inherited columns — `FromBaseType` and `CanBeDeleted` are the discriminators; view columns need the opposite (take all) |
| [`fields/getbyinternalnameortitle` 400s for a missing field](rest-api/getbyinternalnameortitle-400-not-404.md) | It throws `ArgumentException` (HTTP 400), not 404 — an existence-check that hard-fails on non-404 never reaches the create path; treat only 200 as "exists" |

### lists/

| Gotcha | TL;DR |
|---|---|
| [Seed idempotency must key on the item](lists/seed-idempotency-must-key-on-the-item.md) | A per-SET presence check re-inserts the whole block when another path creates it — key on set+value, and ship a cleanup |
| [The 5,000-item view threshold](lists/list-view-threshold-and-indexes.md) | It's about scanned rows, not returned rows — index early, filter indexed-first, page always |
| [View formatting JSON can't contain `<` or `&`](lists/view-formatter-rejects-angle-bracket-and-ampersand.md) | The formatter lives inside the view's schema XML — `XmlException` on save via PnP, CSOM *and* REST; reverse the comparison, nest `if()` instead of `&&` |
| [An empty Date field is not `''`](lists/empty-date-is-not-an-empty-string-in-formatting.md) | `@currentField == ''` misses blank dates, so they coerce to the epoch and render as overdue — test `.displayValue`, and mind that column and row formatting want different syntax |
| [Gallery cards render from `tileProps`](lists/gallery-cards-render-from-tileprops.md) | The documented top-level `formatter` is ignored in a library's Gallery view — the card lives in an undocumented nested `tileProps.formatter`, and `ViewType2 = "TILES"` is what switches the layout. Layout and card must be two separate writes, or the card is overwritten (PnP and REST/SPFx both) |
| [Non-web protocol in `href` drops the whole element](lists/formatter-href-non-web-protocol-drops-element.md) | An `ms-word:` link doesn't render as broken — the element vanishes with all children, per item, no error; open-in-app belongs to `customRowAction: "openContextMenu"` |
| [`length()` is for arrays, not strings](lists/formatting-length-is-for-arrays-not-strings.md) | On a string the arithmetic collapses and `substring` renders empty — get string length as `indexOf(str + '^', '^')` |

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
| [CDN-hosted bundle still needs a new `.sppkg`](spfx/cdn-hosted-bundle-still-needs-new-sppkg.md) | `includeClientSideAssets: false` moves assets, not versioning — the manifest pins a content-hashed filename |
| [`npm audit --omit=dev` overstates shipped risk](spfx/npm-audit-omit-dev-overstates-shipped-risk.md) | SPFx keeps its build toolchain in `dependencies` — grep the published bundle, with a control sample |
| [Centered flex clips on mobile](spfx/centered-flex-clips-on-mobile.md) | `justify-content:center` + overflow = content cut off above the scroll — use flex "springs" instead |
| [JSX attributes and smart quotes](spfx/jsx-attributes-and-smart-quotes.md) | Typographic quotes in `"…"` attributes = TS1003 — wrap localized strings as `{'…'}` |
| [A shared component's var() fallback chain is only as good as its last link](spfx/shared-component-var-fallback-lands-on-system-font.md) | Extracted components render in the browser's default font in any app that keeps tokens as TS constants — the terminal fallback must be your brand stack |
| [Portaled overlays miss your CSS reset](spfx/portaled-overlays-miss-your-css-reset.md) | `createPortal` to `body` escapes `.app-root` — fields inherit `content-box`, overflow by 26px, panel grows a scrollbar |
| [`behavior: 'smooth'` is silently ignored inside a portaled overlay](spfx/smooth-scroll-ignored-in-portaled-overlay.md) | Clicking a table-of-contents entry in a modal does nothing — smooth scroll never runs over a scroll-locked `body`; set `scrollTop` directly |
| [Previewing library files in your own app](spfx/previewing-library-files-in-your-app.md) | PDF embeds from its URL, Office needs WOPI keyed by {UniqueId}, HTML is served as an attachment — an iframe src leaves a blank frame with a clean console |
| [Auto-save must wait for async inputs](spfx/autosave-effect-must-wait-for-async-inputs.md) | An effect saving a value computed from async-loaded state fires on mount with empty inputs — gate on a loaded flag, read inputs strictly |
| [Application Customizer runs again in dialog iframes](spfx/application-customizer-runs-in-dialog-iframe.md) | Your floating button shows up twice — the copy is pinned to the dialog's corner because the dialog *is* its viewport; refuse `window.self !== window.top` |
| [`speechSynthesis.cancel()` doesn't stop chunked reading](spfx/speech-cancel-doesnt-stop-chunked-reading.md) | Stop needs N clicks and two messages read over each other — the utterance chain re-queues itself from `onend`; guard with an epoch counter bumped before `cancel()` |
| [Application Customizer's floating UI disappears on SPA navigation](spfx/application-customizer-content-disappears-on-spa-navigation.md) | The button vanishes as you click around the site — `onInit` doesn't re-run on SPA nav and `visibilitychange` never fires; re-render on `navigatedEvent` |

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
| [az CLI can't grant Sites.Selected](graph/az-cli-cannot-grant-sites-selected.md) | `sites/{id}/permissions` needs `Sites.FullControl.All`, which the CLI client can't request (`AADSTS65002`) — use the Graph PowerShell SDK |
| [Re-read fresh before bulk-removing members](graph/reread-fresh-before-bulk-membership-removal.md) | The roster you showed is a preview, not truth — re-read strict & fresh before a `removeMember` loop; read error aborts, a vanished member is an idempotent skip, guard each delete |
| [directoryObject collections reject `$select` — and `$top` separately](graph/directoryobject-collections-reject-select-and-top.md) | `$select` of user fields on `/members`/`/memberOf`/`/transitiveMembers` = 400; an OData cast cures that everywhere but `$top` stays refused per-endpoint — probe both, they're independent |
| [`$filter` on group members needs `$count=true` too](graph/filter-on-group-members-needs-count-too.md) | `ConsistencyLevel: eventual` alone still 400s on navigation collections — send the pair, or read unfiltered and decide client-side; a best-effort catch hides it as a fake outage |

### azure-functions/

The standard server-side companion of an SPFx solution — and its own set of traps.

| Gotcha | TL;DR |
|---|---|
| [Windows zip deploy breaks the running app](azure-functions/windows-zip-deploy-breaks-running-app.md) | Copying onto a live `wwwroot` corrupts files → whole app 503 — re-run the deploy (not restart); prevent with `WEBSITE_RUN_FROM_PACKAGE=1` |
| [Rate limit counts the capability probe](azure-functions/rate-limit-counts-capability-probe-corporate-nat.md) | Per-IP limits behind corporate NAT = per-company limits — metered "what can you do?" probes silently kill the feature's UI |

### search/

| Gotcha | TL;DR |
|---|---|
| [Search ignores unknown managed properties — silently](search/unknown-managed-properties-fail-silently.md) | A fake property name returns HTTP 200 and full results — auto-created `*OWSCHCS`/`ows_*` are not queryable; probe with a deliberately invalid name, then map to `RefinableString` |
| [ViewsX properties sort only by `ViewsLifeTime`](search/viewsx-properties-sort-only-by-viewslifetime.md) | Windowed view counts select fine but don't sort — one lifetime-sorted query, re-rank client-side |
| [Compare SharePoint paths decode-first](search/compare-sharepoint-paths-decode-first.md) | Browser URLs are %-encoded, search `Path` is decoded — normalize both, then boundary-aware prefix match |
| [Don't trust the parsed-file-types table: SPO does index `.md`](search/md-is-fulltext-indexed-despite-the-docs.md) | The official table omits Markdown, yet live SPO full-text indexes it — probe capability tables before you architect around them |
| [Graph Search returns 0 hits — you passed the question as the `queryString`](search/graph-search-raw-question-returns-nothing.md) | A question isn't a query and "what's new" isn't a search — translate to keywords, use `*` + the default date sort, and only documented per-entity KQL |
| [An unparenthesized `OR` silently escapes your scope filter](search/kql-or-escapes-your-scope-filter.md) | KQL `AND` binds tighter than `OR` — `a OR b Path:"…"` = `a OR (b AND Path)`; wrap the whole user/AI query in parentheses |
| [Sensitivity labels in Search — property works, licensing gates it](search/sensitivity-labels-in-search-and-licensing.md) | `InformationProtectionLabelId` returns a GUID only after AIP-enable + label + crawl; unlicensed tenants can't even create a label (`InvalidLicenseException`) |

### powershell/

| Gotcha | TL;DR |
|---|---|
| [PS 5.1 `Get-Content` mangles UTF-8](powershell/get-content-mangles-utf8.md) | ANSI-default reads double-encode diacritics (`á`→`Ã¡`), and non-ASCII in the pattern makes `-replace` match nothing — go through `System.IO.File` with BOM-less `UTF8Encoding` |
| [Smart quotes are string delimiters](powershell/smart-quotes-are-string-delimiters.md) | PS parses `„` and `"` like ASCII `"` — localized text belongs in single-quoted here-strings |
| [`'Stop'` + a native stderr warning = terminating error](powershell/erroractionpreference-stop-native-stderr.md) | `$ErrorActionPreference='Stop'` escalates a benign stderr warning (exit 0) to a script-killer — wrap in `'Continue'`, judge by `$LASTEXITCODE` |
| [`Get-PnPList -Identity` rejects server-relative URLs](powershell/get-pnplist-identity-rejects-server-relative-url.md) | Resolves by title, GUID, or web-relative URL only — `/sites/team/shared` fails as "List does not exist"; prefer the GUID |
| [PS7 `[ref]` arguments break Office COM calls](powershell/ps7-ref-arguments-break-com-calls.md) | The VBA-style `SaveAs2([ref]$path, [ref]$fmt)` dies with "psobject to Object" on PowerShell 7 — pass plain values positionally |

### security/

| Gotcha | TL;DR |
|---|---|
| [Stored XSS via list content](security/stored-xss-from-list-content.md) | React doesn't block `javascript:` hrefs or sanitize SVG — allowlist `safeHref` with C0-strip at every sink |
| [Field hiding is not a permission](security/field-hiding-is-not-a-permission.md) | Role-based UI field hiding is cosmetic — Read on the list means REST/Export/other web parts see it; confidentiality needs a separate list, item perms, or a server tier |
| [CSV export executes formulas](security/csv-export-of-list-data-executes-formulas.md) | A member-written cell starting `= + - @` (or TAB/CR) runs in Excel on the reader's machine — quoting doesn't disarm it, an apostrophe prefix does |

### tooling/

| Gotcha | TL;DR |
|---|---|
| [Git Bash mangles backslashes for native exes](tooling/git-bash-mangles-backslashes-for-native-exes.md) | `[\\/]` arrives as `[/]` — Windows-path regexes silently under-match; use `.{1,4}` or run from PowerShell |
| [GitHub Pages certificate stuck](tooling/github-pages-certificate-stuck.md) | Domain added before DNS existed → cert never arrives — remove & re-add the domain to restart provisioning |
| [NUL byte makes grep treat a file as binary](tooling/nul-byte-makes-grep-treat-file-as-binary.md) | One raw U+0000 in a literal and every grep-based sweep silently skips the file — write the escape, detect with `file` |

## Writing your own

Use the skeleton in [CONTRIBUTING](../CONTRIBUTING.md) — one trap per file, error messages verbatim, code that fixes it.
