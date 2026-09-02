# 💥 Gotchas

Real-world SharePoint traps, documented as **symptom → cause → fix** — so a problem that cost us hours costs you minutes.

Every article carries frontmatter with `tags` and `applies-to`, so repo search gets you there fast (try `path:gotchas threshold`).

## Index

### rest-api/

| Gotcha | TL;DR |
|---|---|
| [Unbounded `Promise.all` fan-out invites 429](rest-api/unbounded-promise-all-fanout-throttling.md) | Fan-out is safe when your code decides the count, dangerous when the customer's data does. Bounded batch / worker-pool patterns. |
| [Get lists by URL, not by title](rest-api/get-list-by-url-not-by-title.md) | `getbytitle()` breaks the moment someone renames a list — resolve by URL instead |
| [Actions go before the alias query string](rest-api/actions-must-precede-the-alias-query-string.md) | Appending `/breakroleinheritance(...)` to a `GetList(@u)?@u=...` URL buries the action inside the parameter — splice it in before the `?` |
| [FieldValuesAsText re-encodes underscores in JSON keys](rest-api/fieldvaluesastext-reencodes-underscores.md) | `A_x0020_B` comes back as `A_x005f_x0020_x005f_B` — decode `_x005f_` before matching keys |
| [Search REST needs `odata-version: 3.0`](rest-api/search-api-needs-odata-version-3.md) | The header that turns mysterious search 500s into working queries |
| [DateTime: write full ISO, derive days locally](rest-api/datetime-write-full-iso-read-local-day.md) | No-timezone writes 400; UTC reads shift the day — `toISOString()` in, local getters out |
| [`__metadata` body requires verbose](rest-api/metadata-body-requires-verbose.md) | Old-tutorial payloads 400 in modern clients — drop the hint or go verbose on both headers |
| [File upload 406 needs verbose](rest-api/file-upload-406-needs-verbose.md) | `/Files/add` is a classic endpoint — `odata=verbose` + `OData-Version: 3.0`, plus the empty-filename mobile trap |
| [Apostrophes in OData literals](rest-api/odata-string-literals-and-apostrophes.md) | `encodeURIComponent` leaves `'` alone — double it, or O'Brien breaks your filters |
| [Choice fields accept any value](rest-api/choice-fields-accept-any-value.md) | Validation is a form-only illusion — REST writes anything; enforce vocabulary yourself |
| [Lookup fields need `$expand`](rest-api/lookup-fields-need-expand.md) | Relations, not values — read via `$expand` + projected fields, write via `<Name>Id`; mind the ~12-lookup limit |
| [File size needs `$expand=File`](rest-api/file-size-needs-expand-file.md) | `File_x0020_Size` is computed and 400s in `$select` — use `File/Length` + `File/UIVersionLabel` |
| [Uploaded `.html` gains mso document properties](rest-api/html-upload-gains-mso-document-properties.md) | Writing column values rewrites the file with `<mso:CustomDocumentProperties>` — SHA-1 read-back fails for markup, holds for binaries |
| [“Invalid text value” is a MaxLength 500](rest-api/invalid-text-value-is-a-maxlength-500.md) | A `Text` column over 255 chars fails with a generic 500 that names no field — check `TypeAsString`/`MaxLength`, then bisect the body |
| [Create a modern page via REST (3-step)](rest-api/create-modern-page-via-rest-sitepages.md) | `CanvasContent1` won't stick on create — it's create → SavePageAsDraft → Publish, and the canvas is JSON, not HTML |
| [`$filter` on multi-value person fields 400s](rest-api/filter-on-multivalue-person-field-400.md) | UserMulti projections don't filter server-side — fall back to client filtering, but only on HTTP 400 |
| [`GetStorageEntity` returns 200 for a missing key](rest-api/getstorageentity-returns-200-for-missing-key.md) | Unset tenant property answers `200 {"odata.null":true}` — status codes cannot tell "unset" from "failed"; writing needs Tenant Admin |
| [Silent read failure drives delete-all](rest-api/silent-read-failure-drives-delete-all.md) | An empty array from a throttled read is indistinguishable from an empty source — reconciliation then deletes everything |
| ["File is missing" vs. "I cannot read it"](rest-api/missing-file-404-vs-cannot-read.md) | A `T \| null` read helper folds 404, 403, 500 and network failure into one null — the friendly empty state then lies to the user who has overdue work |
| [A deleted site vs. a site you cannot see](rest-api/deleted-site-vs-site-you-cannot-see.md) | `_api/web` on a non-existent site answers 404 (measured), so `if (!r.ok)` makes a dead row in your own inventory look like a site you merely lack access to — keep `r.status` and give the two opposite treatment |
| [App page properties are not in CanvasContent1](rest-api/app-page-webpart-properties-not-in-canvascontent.md) | Single-part app pages keep web part config elsewhere — the property pane and the runtime tree are the truth |
| [Silent fallbacks poison destructive writes](rest-api/silent-fallbacks-poison-destructive-writes.md) | `catch → []` is great for rendering and catastrophic for delete-then-insert syncs — offer strict and safe reads |
| [Provisioning skips schema changes to existing fields](rest-api/provisioning-skips-schema-changes-to-existing-fields.md) | "Create field if missing" never updates an existing field — a new Choice value in your manifest no-ops on deployed sites; reconcile with a verbose `SP.FieldChoice` MERGE that only ever *widens* the set — `Choices` is replace, so a failed read of the current values collapses the union into the manifest and deletes everything else |
| [`X-RequestDigest` expires mid-session](rest-api/request-digest-expires-mid-session.md) | Writes 403 "security validation is invalid" on a long-open page — the page digest times out (~30 min); fetch a fresh one from `/_api/contextinfo` per write |
| [PDF conversion endpoint: plain fetch only](rest-api/pdf-conversion-endpoint-plain-fetch-only.md) | `format=pdf` converts Office files server-side without Graph consent — but the 302 to `*.svc.ms` breaks under auth-decorating clients; plain `fetch` + Content-Type guard |
| [Don't cache a throttled permission probe](rest-api/dont-cache-a-throttled-permission-probe.md) | A 429/403 on `currentuser/groups` resolves to the lowest role — cache it and the user is stuck read-only for the TTL; only persist a confirmed (200) result |
| [The browser cache answers your read-after-write check — with a 200](rest-api/browser-cache-answers-your-read-after-write-check.md) | The same URL read on both sides of a write comes back from the browser cache, so `res.ok` guards pass on stale state — a cached existence check makes `POST /fields` create a duplicate column and report success; bust only reads on the write path |
| [Telling a list's own columns from inherited ones](rest-api/which-columns-are-the-librarys-own.md) | Snapshotting a list schema: filtering on `Hidden`/`ReadOnlyField` still leaves ~40 inherited columns — `FromBaseType` and `CanBeDeleted` are the discriminators; view columns need the opposite (take all) |
| [A page-size cap reported as a finding](rest-api/page-size-cap-reported-as-a-result.md) | "100 commits", "500 guests", "5,000 items" — one unpaged request returns exactly the cap; ask for the count instead of counting what arrived |
| [File versions come back oldest-first](rest-api/file-versions-are-oldest-first.md) | `/Versions` is ascending — `$top` truncates the NEWEST versions, and a client-side descending sort makes the gap invisible |
| [Retrying a throttled call is safe for GET only](rest-api/retry-on-throttling-only-for-get.md) | A throttled `POST` may already have been applied — SharePoint has no idempotency key, so the retry writes a second item; retry on the method, not the status code |
| [`ensureuser` returns the login name](rest-api/ensureuser-returns-the-login-name.md) | The response already holds `LoginName` — re-querying `siteusers` by `Email` misses every account whose UPN differs |
| [`fields/getbyinternalnameortitle` 400s for a missing field](rest-api/getbyinternalnameortitle-400-not-404.md) | It throws `ArgumentException` (HTTP 400), not 404 — an existence-check that hard-fails on non-404 never reaches the create path; treat only 200 as "exists" |
| [Check-then-insert races produce duplicate rows](rest-api/check-then-insert-races-duplicate-rows.md) | no unique constraint + eventual consistency = double insert; dedup on read by version, never delete "lowest Id" |
| [There is no `sitegroups/removebyname`](rest-api/delete-group-by-name-no-removebyname.md) | `GroupCollection` has `GetByName` but only `RemoveById`; resolve the Id first, then delete; verify with `getbyname` → 404 |
| [Field written but missing from `$select`](rest-api/field-written-but-missing-from-select.md) | `$select` is an allowlist; a `snapshot ?? live` fallback silently erases the feature the snapshot exists for |
| [`GetObjectSharingInformation` traps](rest-api/getobjectsharinginformation-traps.md) | GET is 405 every time (stop retrying it: 2.7× slower), `CreatedBy` is always null, `$expand` is dead weight |
| [`/_api/HubSites` returns an empty list, not 403](rest-api/hubsites-returns-empty-list-not-403.md) | the hub list is security-trimmed, so an account that cannot read the hub sites gets `value: []` with HTTP 200; "this site has no hub" and "no inherited owner" must never be derived from it — read `IsHubSite`/`HubSiteId` from `_api/site` and treat "belongs to a hub that is not in the list" as unknown |

### lists/

| Gotcha | TL;DR |
|---|---|
| [Seed idempotency must key on the item](lists/seed-idempotency-must-key-on-the-item.md) | A per-SET presence check re-inserts the whole block when another path creates it — key on set+value, and ship a cleanup |
| [Version-gated provisioning drops elevated settings](lists/version-gated-provisioning-drops-elevated-settings.md) | `Hidden`/`ReadSecurity` are a PATCH needing Manage Lists — if a member opens the app first, the 403 is swallowed, the version is stored and the setting never applies again |
| [Item-level permission defaults on provisioned lists](lists/item-level-permissions-defaults-on-provisioned-lists.md) | `ReadSecurity=2` returns 200 + zero items to members while admins bypass it; `WriteSecurity=2` breaks approvals and shared edits |
| [Hand-built .docx / .pptx: the parts Office demands](spfx/hand-built-ooxml-missing-parts.md) | Header image rels, Content_Types image extension, per-part namespaces, and the theme/master/layout a .pptx cannot open without |
| [Created/Modified on a document library](lists/created-modified-on-a-document-library.md) | A plain MERGE returns 204 and is then overwritten; only `ValidateUpdateListItem` + `bNewDocumentUpdate` sticks, and it wants a locale date — ISO fails with HTTP 200 and `HasException` |
| [Column internal name comes from DisplayName](lists/field-internal-name-comes-from-displayname.md) | `createfieldasxml` ignores `Name`/`StaticName` on a list, so a localized label leaves you with `_x00da_tvar`; create ASCII, rename after |
| [Reader-written counters belong in their own list](lists/reader-written-counters-belong-in-their-own-list.md) | Views and "was this helpful?" are written by the reader — on a `WriteSecurity: 4` content list every click is a swallowed 403 while the UI still says thanks; split the counters into a `writeSecurity: 1` list and sum both on read |
| [Item IDs are never reused — unless the list is recreated](lists/item-ids-are-not-reused-but-recreated-lists-restart.md) | Emptying a list does not rewind its counter (26 items purged → next ones got 26–51, then 52–77), so orphaned rows in a derived list are dead weight, not misattributed data — until provisioning recreates the list and the counter restarts at 1 |
| [Indexing built-in fields (Title, Created)](lists/indexing-built-in-fields-title-created.md) | Provisioning indexes the columns it creates; `Title`/`Created` are created by SharePoint, so they are the unindexed fields your `$filter`/`$orderby` actually hit — past 5,000 items the read throttles and a plain `if (!r.ok) return` in a WRITE path means nothing is ever saved again |
| [The 5,000-item view threshold](lists/list-view-threshold-and-indexes.md) | It's about scanned rows, not returned rows — index early, filter indexed-first, page always |
| [View formatting JSON can't contain `<` or `&`](lists/view-formatter-rejects-angle-bracket-and-ampersand.md) | The formatter lives inside the view's schema XML — `XmlException` on save via PnP, CSOM *and* REST; reverse the comparison, nest `if()` instead of `&&` |
| [An empty Date field is not `''`](lists/empty-date-is-not-an-empty-string-in-formatting.md) | `@currentField == ''` misses blank dates, so they coerce to the epoch and render as overdue — test `.displayValue`, and mind that column and row formatting want different syntax |
| [Gallery cards render from `tileProps`](lists/gallery-cards-render-from-tileprops.md) | The documented top-level `formatter` is ignored in a library's Gallery view — the card lives in an undocumented nested `tileProps.formatter`, and `ViewType2 = "TILES"` is what switches the layout. Layout and card must be two separate writes, or the card is overwritten (PnP and REST/SPFx both) |
| [Non-web protocol in `href` drops the whole element](lists/formatter-href-non-web-protocol-drops-element.md) | An `ms-word:` link doesn't render as broken — the element vanishes with all children, per item, no error; open-in-app belongs to `customRowAction: "openContextMenu"` |
| [`length()` is for arrays, not strings](lists/formatting-length-is-for-arrays-not-strings.md) | On a string the arithmetic collapses and `substring` renders empty — get string length as `indexOf(str + '^', '^')` |
| [View formatting lands on the wrong view](lists/view-formatting-lands-on-the-wrong-view.md) | No `AllItems.aspx` in Site Pages and a grouped default view — plus a column absent from the view is `undefined`, not `''`, so the hide guard never fires |
| [`MajorVersionLimit: 0` means unlimited, not none](lists/major-version-limit-zero-means-unlimited.md) | Zero is the API's "no limit" — and also what you get when versioning is off; a report printing the raw number says the opposite of the truth |
| [A version is a full copy, not a delta](lists/a-version-is-a-full-copy-not-a-delta.md) | Every version counts against the quota at the full file size, and a metadata-only edit creates one — measured: three column edits turned a 1 MiB file into 4 MB. "Shredded storage" is a SQL-level mechanism in on-prem SharePoint that the quota component explicitly does not track |

### permissions/

| Gotcha | TL;DR |
|---|---|
| [WriteSecurity 4 ignores Contribute](permissions/write-security-4-needs-managelists.md) | Only ManageLists overrides the item-level write block — Contribute does not have it, so the obvious grant changes nothing |
| [Breaking inheritance without copying keeps only you](permissions/break-without-copy-keeps-only-you.md) | `copyRoleAssignments=false` leaves a single role assignment — the caller — so re-granting Owners/Members/Visitors silently drops direct grants and custom groups; and an account that loses a *config* read can end up with that feature's limits switched off, so hardening lowers security for the one it locked out |
| [`HasUniqueRoleAssignments` proves the break, not the hardening](permissions/unique-role-assignments-is-not-proof-of-hardening.md) | the flag flips after step one, so a check that stops there reports "locked" over a list whose trim step never ran — and because the safe break is `copy=true`, that half-done state is worse than inheritance: the object owns a private copy of Members-with-Edit, which carries `ManageLists` |
| [A one-sided permission check passes on an empty ACL](permissions/one-sided-permission-check-passes-on-an-empty-acl.md) | "Nobody outside the allow-list can write" is also true when nobody can write at all — assert the other direction and a non-zero writer count, and read strictly so a 429 cannot drop a group out of the policy |

### spfx/

| Gotcha | TL;DR |
|---|---|
| [A global kill-switch must not block its own fix](spfx/kill-switch-must-not-block-its-own-fix.md) | Expired licence / suspended / read-only guarding the version switch means the fix that exists cannot be applied — exit only via DevTools |
| [Graph grants are tenant-wide](spfx/graph-permission-grants-are-tenant-wide.md) | `webApiPermissionRequests` only asks; the approval sits on the tenant's Client Extensibility principal, so every SPFx component inherits it — your feature may work before deployment and break at a customer whose tenant never approved it |
| [The ES2015 `lib` trap](spfx/es2015-lib-forbidden-apis.md) | Why `padStart` and friends fail the build (TS2550), and the safe equivalents |
| [Dropping a folder does nothing](spfx/drag-drop-folders-webkitgetasentry.md) | `dataTransfer.files` never sees a folder, `items` is dead after the first `await`, and `readEntries()` hands back the contents 100 at a time |
| [Opening a pre-filled e-mail in the desktop client](spfx/open-email-in-desktop-client-eml.md) | The browser cannot detect the default mail client — ask once; `mailto:` gets you there without an attachment, a `.eml` with `X-Unsent: 1` gets you there with one |
| [SPA router hijacks anchor clicks](spfx/spa-router-hijacks-anchor-clicks.md) | On published pages, `<a href>` navigates before React `onClick` runs — use buttons for in-app actions |
| [Third-party CSS breaks webpack](spfx/css-url-assets-break-webpack.md) | `url(images/...)` without `./` kills the build (Leaflet et al.) — inject a `<link>` instead of importing |
| [Minified React errors cheatsheet](spfx/react-minified-errors-cheatsheet.md) | #310/#300 = hooks after early returns, #31 = object as child, #185 = setState loop — decoded for SPFx |
| [People search endpoints that work](spfx/people-search-endpoints-that-work.md) | `clientPeoplePickerSearchUser` comes back empty, `siteusers` is not a directory — use the SP Search People source + `ensureuser` |
| [Fixed dropdowns in transformed panels](spfx/fixed-dropdowns-in-transformed-panels.md) | `transform` makes ancestors the containing block even for `position: fixed` — portal your dropdowns to `document.body` |
| [`SP.WebProxy` is add-in-only](spfx/webproxy-is-add-in-only.md) | There is no SharePoint-native CORS proxy for SPFx — 403 "without an app context", hidden inside an HTTP 200 |
| [Teams personal app needs global deploy](spfx/teams-personal-app-needs-global-deploy.md) | `skipFeatureDeployment: true` + "all sites", or the root-hosted app crashes on `componentType`; plus the `teams/` icon-folder convention |
| [Teams mobile webview renders desktop width](spfx/teams-mobile-webview-renders-desktop-width.md) | ~980px layout you can't reproduce in a browser — fix the viewport meta in Teams, then debug breakpoints |
| [Shared component measures the viewport, not its container](spfx/shared-component-measures-viewport-not-container.md) | Media queries can't see the 420px panel you were dropped into — measure with `ResizeObserver` and switch the whole layout |
| [CDN-hosted bundle still needs a new `.sppkg`](spfx/cdn-hosted-bundle-still-needs-new-sppkg.md) | `includeClientSideAssets: false` moves assets, not versioning — the manifest pins a content-hashed filename |
| [`npm audit --omit=dev` overstates shipped risk](spfx/npm-audit-omit-dev-overstates-shipped-risk.md) | SPFx keeps its build toolchain in `dependencies` — grep the published bundle, with a control sample |
| [Centered flex clips on mobile](spfx/centered-flex-clips-on-mobile.md) | `justify-content:center` + overflow = content cut off above the scroll — use flex "springs" instead |
| [JSX attributes and smart quotes](spfx/jsx-attributes-and-smart-quotes.md) | Typographic quotes in `"…"` attributes = TS1003 — wrap localized strings as `{'…'}` |
| [A conditional spread hides a phantom list column](spfx/conditional-spread-hides-a-phantom-list-column.md) | `...(cond ? {…} : {})` skips TypeScript's excess-property check — the extra field reaches SharePoint and 400s |
| [A shared component's var() fallback chain is only as good as its last link](spfx/shared-component-var-fallback-lands-on-system-font.md) | Extracted components render in the browser's default font in any app that keeps tokens as TS constants — the terminal fallback must be your brand stack |
| [Read-only mode must cover Graph too](spfx/read-only-mode-must-cover-graph-too.md) | Wrapping `SPHttpClient` blocks list writes but not `MSGraphClientFactory` — "read-only" still sends mail and creates tasks |
| [Provisioning step gated on success runs forever](spfx/provisioning-step-gated-on-success-runs-forever.md) | A startup step needing ManageLists writes no marker for ordinary members, so the whole batch replays on every page load. The marker needs two states. |
| [Command set button never appears](spfx/command-set-button-never-appears.md) | Uploading a new `.sppkg` does not register the extension on a site, and `raiseOnChange()` never re-runs `onListViewUpdated` — decide visibility in one method called from both triggers |
| [Injecting your own column into the modern list grid](spfx/modern-list-grid-inject-custom-column.md) | Appending a cell shifts the whole table — rows are `display: contents`, so cells are the grid items and each carries an explicit `grid-column`/`grid-row` |
| [Reading the modern list selection from the DOM](spfx/reading-list-selection-from-the-dom.md) | Only a command set gets `selectedRows`; from the DOM take names only, resolve paths per folder, and read the real count from the clear-selection button — the view is virtualized |
| [Portaled overlays miss your CSS reset](spfx/portaled-overlays-miss-your-css-reset.md) | `createPortal` to `body` escapes `.app-root` — fields inherit `content-box`, overflow by 26px, panel grows a scrollbar |
| [A theme override on your app root can't reach tokens declared on `:root`](spfx/theme-override-cant-reach-root-declared-tokens.md) | A tenant theme applies to the accent but not to headings or panels — `var()` resolves where it is declared, so an override on a descendant recomputes nothing |
| [`behavior: 'smooth'` is silently ignored inside a portaled overlay](spfx/smooth-scroll-ignored-in-portaled-overlay.md) | Clicking a table-of-contents entry in a modal does nothing — smooth scroll never runs over a scroll-locked `body`; set `scrollTop` directly |
| [Previewing library files in your own app](spfx/previewing-library-files-in-your-app.md) | PDF embeds from its URL, Office needs WOPI keyed by {UniqueId}, HTML is served as an attachment — an iframe src leaves a blank frame with a clean console |
| [Auto-save must wait for async inputs](spfx/autosave-effect-must-wait-for-async-inputs.md) | An effect saving a value computed from async-loaded state fires on mount with empty inputs — gate on a loaded flag, read inputs strictly |
| [Application Customizer runs again in dialog iframes](spfx/application-customizer-runs-in-dialog-iframe.md) | Your floating button shows up twice — the copy is pinned to the dialog's corner because the dialog *is* its viewport; refuse `window.self !== window.top` |
| [`speechSynthesis.cancel()` doesn't stop chunked reading](spfx/speech-cancel-doesnt-stop-chunked-reading.md) | Stop needs N clicks and two messages read over each other — the utterance chain re-queues itself from `onend`; guard with an epoch counter bumped before `cancel()` |
| [Application Customizer's floating UI disappears on SPA navigation](spfx/application-customizer-content-disappears-on-spa-navigation.md) | The button vanishes as you click around the site — `onInit` doesn't re-run on SPA nav and `visibilitychange` never fires; re-render on `navigatedEvent` |
| [Per-user data vanishes for admin accounts](spfx/user-email-is-empty-for-mailbox-less-accounts.md) | Mailbox-less accounts get an empty `user.email`; the rows save with an empty key, SharePoint stores it as NULL, and `eq ''` then matches nothing |
| [serverRequestPath is not the page URL](spfx/server-request-path-is-not-the-page-url.md) | It is the path of the last SERVER REQUEST — on a modern list view it can be a REST endpoint, and stored as "where my app lives" every link lands on an XML error |
| [Parser entry and collector must share one shape](spfx/parser-entry-and-collector-must-share-one-shape.md) | An entry regex accepting more than the collector loop consumes re-reads the same line forever — the tab dies of out-of-memory, and it looks machine-specific because the trigger is the USER'S DATA |
| [Sharing text via URL hits length limits](spfx/share-text-via-url-hits-length-limits.md) | "Send to Teams" dies with `AADSTS90015` and `mailto` silently won't open on long text — cap the URL payload, carry the full text on the clipboard |
| [A cached dynamic `import()` caches the rejection too](spfx/cached-rejected-dynamic-import.md) | one chunk-load blip poisons the module-level promise for the whole session; reset it to null in `.catch` so the next call retries |
| [Deep-link param appended to a page URL that already has one](spfx/deep-link-param-appended-to-a-page-that-has-one.md) | the address an admin pastes already carries your routing param, so appending makes it appear twice and `URLSearchParams.get` reads the OLD value; replace the key, never append |
| [An element selector outranks your button class](spfx/element-selector-outranks-your-button-class.md) | `.app-root a { color: inherit }` beats `.btn--accent`, so link-styled buttons get an unreadable label — but only on a tenant whose accent needs white text |
| [A Promise over img.onload can hang forever](spfx/image-promise-without-a-timeout-hangs-forever.md) | onload/onerror are not guaranteed to fire; try/catch guards rejection, not a Promise that never settles |
| [Instrumenting the Graph client fails silently](spfx/instrumenting-the-graph-client-fails-silently.md) | reassigning `client.api` throws and your fail-safe catch hides it; use `Object.create` and assert it attached |
| [`jest.mock()` doesn't hoist under Heft](spfx/jest-mock-doesnt-hoist-in-heft.md) | tests run over pre-compiled `lib-commonjs` without Babel, so the mock lands after `require`; use `moduleNameMapper` (and why only *some* sp-http suites die on `@msinternal/ecs-flight`) |
| [Mermaid clips node text with a web font](spfx/mermaid-text-clipping-webfont.md) | measure-before-load (FOUT) sizes boxes for the fallback font; use a system font stack |
| [Office file extraction needs a decompressed-size cap](spfx/office-file-extraction-needs-a-decompressed-size-cap.md) | an upload-size limit only bounds the compressed archive; a crafted `!ref` still OOMs the tab |
| [rules-of-hooks false-positive from a JSX `&&` chain](spfx/rules-of-hooks-false-positive-from-jsx-chain.md) | a complex conditional in your render blames the *wrong* hook; extract it to a `const`. Second trigger: sheer component *size* — there extracting conditions doesn't help, splitting the component does. Third trigger: the recommended `const` extraction ITSELF — only block-by-block bisection from a clean HEAD finds the guilty line |
| [Shared package's dynamic import ships inlined](spfx/shared-package-dynamic-import-inlines-with-commonjs.md) | a linked TS package built with module:commonjs turns import() into require(), so webpack can't lazy-chunk the lib into a separate file; set the package's module:esnext |

### app-catalog/

| Gotcha | TL;DR |
|---|---|
| [Three `.sppkg` packaging pitfalls](app-catalog/sppkg-packaging-pitfalls.md) | ASCII-only solution name, icon exactly 96×96, and why the Publisher column stays empty |

### graph/

| Gotcha | TL;DR |
|---|---|
| [Someone else's group membership without `User.Read.All`](graph/check-membership-of-another-user-without-user-read-all.md) | Invert the question: read the group's transitive members; keep a third state for "could not determine" |
| [`/me/sendMail`: From is always the signed-in user](graph/sendmail-from-is-the-signed-in-user.md) | Delegated `Mail.Send` can't impersonate — configurable "sender" settings should govern Reply-To |
| [A `mailto:` fallback reported as sent](graph/sendmail-fallback-reported-as-sent.md) | `sendMail` fails on accounts without a mailbox; the fallback hands off a draft, it doesn't deliver — three states, not a boolean |
| ["0 sent" hides whether anyone was asked](graph/zero-sent-hides-whether-anyone-was-asked.md) | a boolean mail helper conflates "no recipients" with "refused", and `sitegroups/…/users` conflates an empty group with a denied read — together they notify nobody and report success |
| [ApplicationAccessPolicy rejects a shared mailbox](graph/application-access-policy-rejects-shared-mailbox.md) | "Not a security principal" — scope app-only `Mail.Send` to a mail-enabled security group instead |
| [A mail-permission probe that can't tell "no mailbox" from "no consent" lies to admins](graph/mail-probe-no-mailbox-vs-no-consent.md) | `/me/messages` 404 `MailboxNotEnabled*` on mailbox-less accounts is not missing consent — three verdicts, and never cache a negative probe result |
| [Purview Audit Query API is async](graph/purview-audit-query-api-is-async.md) | Queries run for an hour+ — attach to the last succeeded one, create in the background; v1.0 may 404 where beta works |
| [`dont have any permissions` rejects the user, not the app](graph/audit-query-permission-vs-audit-role.md) | Consent got you to the backend; the audit search right is Exchange RBAC — Global Admin usually inherits it, so find what differs about the failing account |
| [Office files: property demotion changes the hash](graph/office-files-property-demotion.md) | A metadata PATCH rewrites bytes inside docx/xlsx — `cTag` and even content hashes lie; key change detection on `lastModifiedBy` |
| [Usage reports are CORS-blocked in the browser](graph/usage-reports-cors-blocked-in-browser.md) | Reports 302 to a host without CORS headers — fetch server-side; browse-time inventory = SP Search + `/_api/site/usage` |
| [Tenant-wide enumeration is app-only](graph/tenant-wide-enumeration-is-app-only.md) | `getAllSites` & friends reject delegated tokens with a silent 403 — check the Permissions table *before* building |
| [`MSGraphClient` calls bypass DevTools Network](graph/msgraphclient-calls-bypass-devtools-network.md) | SPFx Graph traffic doesn't show in the Network tab — diagnose with `performance` entries, `currentuser`, the DOM, and the user's own response |
| [`PATCH /me`: directory vs profile fields](graph/patch-me-directory-vs-profile-fields.md) | Mixing `jobTitle` with `aboutMe` fails the whole request — two PATCHes, profile one best-effort |
| [az CLI can't grant Sites.Selected](graph/az-cli-cannot-grant-sites-selected.md) | `sites/{id}/permissions` needs `Sites.FullControl.All`, which the CLI client can't request (`AADSTS65002`) — use the Graph PowerShell SDK |
| [Re-read fresh before bulk-removing members](graph/reread-fresh-before-bulk-membership-removal.md) | The roster you showed is a preview, not truth — re-read strict & fresh before a `removeMember` loop; read error aborts, a vanished member is an idempotent skip, guard each delete |
| [`perUserMfaState` lies under Conditional Access](graph/per-user-mfa-state-lies-under-conditional-access.md) | The legacy per-user switch reads `disabled` while MFA is fully enforced — report on `userRegistrationDetails` (which omits blocked accounts) and always show what actually enforces MFA |
| [directoryObject collections reject `$select` — and `$top` separately](graph/directoryobject-collections-reject-select-and-top.md) | `$select` of user fields on `/members`/`/memberOf`/`/transitiveMembers` = 400; an OData cast cures that everywhere but `$top` stays refused per-endpoint — probe both, they're independent |
| [`$filter` on group members needs `$count=true` too](graph/filter-on-group-members-needs-count-too.md) | `ConsistencyLevel: eventual` alone still 400s on navigation collections — send the pair, or read unfiltered and decide client-side; a best-effort catch hides it as a fake outage |
| [A pasted screenshot is too big for `/me/sendMail`](graph/sendmail-attachment-size-ceiling.md) | inline base64 attachments share a ~4 MB request budget; shrink bitmaps in a canvas, cap the total, and remember `mailto:` fallbacks carry no attachments at all |
| [`/me/todo` needs an Exchange mailbox](graph/todo-requires-exchange-mailbox.md) | 404 "Item not found" on admin/cloud-only accounts is not a 403; Planner works without a mailbox |

### azure-functions/

The standard server-side companion of an SPFx solution — and its own set of traps.

| Gotcha | TL;DR |
|---|---|
| [Windows zip deploy breaks the running app](azure-functions/windows-zip-deploy-breaks-running-app.md) | Copying onto a live `wwwroot` corrupts files → whole app 503 — re-run the deploy (not restart); prevent with `WEBSITE_RUN_FROM_PACKAGE=1` |
| [Verifying CORS by header presence passes every origin](azure-functions/verifying-cors-by-header-presence-passes-every-origin.md) | an allowlist API returns a **fallback** origin rather than omitting the header, so `grep` for the header name says "allowed" for `evil.example` too — compare the value to the `Origin` you sent, and treat a uniform verdict across all inputs as a broken probe |
| [Rate limit counts the capability probe](azure-functions/rate-limit-counts-capability-probe-corporate-nat.md) | Per-IP limits behind corporate NAT = per-company limits — metered "what can you do?" probes silently kill the feature's UI |
| [A pinned Azure OpenAI model+version is a time bomb](azure-functions/azure-openai-pinned-model-version-is-a-time-bomb.md) | "Deprecating" blocks NEW deployments well before retirement — resolve the newest GA version at deploy time |
| ["No such host" for &lt;app&gt;.azurewebsites.net](azure-functions/unique-default-hostname-no-such-host.md) | New apps get a unique default hostname (`<app>-<hash>.<region>-01`) — the bare name never resolves; the deploy log's `.scm.` URL reveals the real host |
| [Measure a third-party API before you build on it](azure-functions/third-party-api-measure-before-you-build-on-it.md) | The canonical free API 404'd/502'd/timed out on 7 of 8 live calls while tests stayed green — probe latency *and* status on real data; then cache successes (never failures) and honour `Retry-After`, because one outbound IP means one shared quota |
| [Cache-Control on a dynamic endpoint is uninvalidatable](azure-functions/cache-control-on-dynamic-endpoint-is-uninvalidatable.md) | `max-age` on a live aggregate lets a shared cache hold it keyed by URL — neither app restart nor deleting the data clears it, only expiry; serve dynamic data `no-store`, cache server-side, call with `?_=Date.now()` |
| [pdf-parse and pdfjs-dist cannot share a process](azure-functions/pdf-parse-and-pdfjs-dist-cannot-share-a-process.md) | Loading pdfjs-dist breaks pdf-parse's bundled pdf.js ("bad XRef entry"), but only for classic xref-table PDFs and from the second request on — one PDF library per process; and load code under test the way production loads it |

### search/

| Gotcha | TL;DR |
|---|---|
| [Search ignores unknown managed properties — silently](search/unknown-managed-properties-fail-silently.md) | A fake property name returns HTTP 200 and full results — auto-created `*OWSCHCS`/`ows_*` are not queryable; probe with a deliberately invalid name, then map to `RefinableString` |
| [Site missing from the index looks like a permissions problem](search/site-missing-from-the-index-looks-like-a-permissions-problem.md) | Zero results for content the user is looking at: measure search itself (target path, `*`, `contentclass:STS_Site`) before touching your code |
| [Enumerate every site from the browser console](search/enumerate-every-site-from-the-browser-console.md) | `contentclass:STS_Site OR STS_Web` over Search REST = tenant inventory for any signed-in user; the F12 sweep traps: don't filter `Hidden`, case-sensitive `GetList`, 400 vs 404, digest per target web |
| [The crawl log DOES exist in SharePoint Online](search/crawl-log-exists-in-spo-via-csom.md) | No REST endpoint and no crawl-time managed property, so it looks absent — it lives in CSOM DocumentCrawlLog.GetCrawledUrls and needs a separate grant that admin roles do not imply |
| [ViewsX properties sort only by `ViewsLifeTime`](search/viewsx-properties-sort-only-by-viewslifetime.md) | Windowed view counts select fine but don't sort — one lifetime-sorted query, re-rank client-side |
| [Compare SharePoint paths decode-first](search/compare-sharepoint-paths-decode-first.md) | Browser URLs are %-encoded, search `Path` is decoded — normalize both, then boundary-aware prefix match |
| [Don't trust the parsed-file-types table: SPO does index `.md`](search/md-is-fulltext-indexed-despite-the-docs.md) | The official table omits Markdown, yet live SPO full-text indexes it — probe capability tables before you architect around them |
| [Graph Search returns 0 hits — you passed the question as the `queryString`](search/graph-search-raw-question-returns-nothing.md) | A question isn't a query and "what's new" isn't a search — translate to keywords, use `*` + the default date sort, and only documented per-entity KQL |
| [An unparenthesized `OR` silently escapes your scope filter](search/kql-or-escapes-your-scope-filter.md) | KQL `AND` binds tighter than `OR` — `a OR b Path:"…"` = `a OR (b AND Path)`; wrap the whole user/AI query in parentheses |
| [Sensitivity labels in Search — property works, licensing gates it](search/sensitivity-labels-in-search-and-licensing.md) | `InformationProtectionLabelId` returns a GUID only after AIP-enable + label + crawl; unlicensed tenants can't even create a label (`InvalidLicenseException`) |
| [`NoCrawl` on a library silently blinds your RAG](search/nocrawl-on-a-library-silently-blinds-your-rag.md) | Excluded containers return 0 with HTTP 200 and no log, so Search-backed AI can never see them; ask what the container *holds*, not its type — and indexing isn't a permission change, Search trims per user |
| [Duplicate trimming hides the file copies you search for](search/duplicate-trimming-hides-file-copies.md) | Search collapses identical content by default — a copy-finder query returns "no copies" precisely when perfect copies exist; add `trimduplicates=false` to duplicate-hunting queries only |
| [Search cannot see text inside images — and what that does to RAG](search/search-cannot-see-text-inside-images.md) | the crawler indexes the text layer only, so a value that exists only in an embedded flyer or a scan can never be found by keyword: a search-then-read pipeline is in a closed loop, the LLM re-ranker drops such documents (it scores text-layer snippets), and the only real fix is transcribing images into a crawled column |

### powershell/

| Gotcha | TL;DR |
|---|---|
| [PS 5.1 `Get-Content` mangles UTF-8](powershell/get-content-mangles-utf8.md) | ANSI-default reads double-encode diacritics (`á`→`Ã¡`), and non-ASCII in the pattern makes `-replace` match nothing — go through `System.IO.File` with BOM-less `UTF8Encoding` |
| [Smart quotes are string delimiters](powershell/smart-quotes-are-string-delimiters.md) | PS parses `„` and `"` like ASCII `"` — localized text belongs in single-quoted here-strings |
| [`'Stop'` + a native stderr warning = terminating error](powershell/erroractionpreference-stop-native-stderr.md) | `$ErrorActionPreference='Stop'` escalates a benign stderr warning (exit 0) to a script-killer — wrap in `'Continue'`, judge by `$LASTEXITCODE` |
| [`Get-PnPList -Identity` rejects server-relative URLs](powershell/get-pnplist-identity-rejects-server-relative-url.md) | Resolves by title, GUID, or web-relative URL only — `/sites/team/shared` fails as "List does not exist"; prefer the GUID |
| [PS7 `[ref]` arguments break Office COM calls](powershell/ps7-ref-arguments-break-com-calls.md) | The VBA-style `SaveAs2([ref]$path, [ref]$fmt)` dies with "psobject to Object" on PowerShell 7 — pass plain values positionally |
| [A syntax check under PS 7 proves nothing about 5.1](powershell/ps7-parse-check-misses-ps51-syntax-errors.md) | `Parser::ParseFile` clears a script full of ternary / `??` / `&&` that 5.1 refuses to parse — run the check inside the oldest engine you support |
| [`Export-Csv -Encoding UTF8` flips the BOM](powershell/export-csv-utf8-bom-flips-between-versions.md) | 5.1 writes the BOM, 7 omits it, Excel decides encoding by it — the same report is readable on one machine and mojibake on the next |
| [PS 5.1: `@(ConvertFrom-Json)` keeps the array wrapped](powershell/convertfrom-json-array-not-unwrapped-in-json-output.md) | `@()` around the pipeline doesn't enumerate the parsed array; a later `+` nests it whole and `ConvertTo-Json` writes `{value:[…],Count:n}` into your JSON — enumerate with `ForEach-Object` and filter by shape |
| [`$host` is a constant you cannot assign](powershell/host-is-a-constant-you-cannot-assign.md) | The natural name for `[uri].Host` is reserved; the error blames the value, not the name — and `$input` / `$args` take the assignment silently |

### security/

| Gotcha | TL;DR |
|---|---|
| [Sanitizer keeps script and style TEXT](security/sanitizer-keeps-script-and-style-text.md) | "Drop the tag, keep the inner text" is right for `<font>`, wrong for `<script>`/`<style>` — it pastes their source into your content. Nothing executes, so security tests pass |
| [Stored XSS via list content](security/stored-xss-from-list-content.md) | React doesn't block `javascript:` hrefs or sanitize SVG — allowlist `safeHref` with C0-strip at every sink |
| [Field hiding is not a permission](security/field-hiding-is-not-a-permission.md) | Role-based UI field hiding is cosmetic — Read on the list means REST/Export/other web parts see it; confidentiality needs a separate list, item perms, or a server tier |
| [Effective permissions come as a bitmask](security/effective-permissions-bitmask-off-by-one.md) | `getUserEffectivePermissions` returns `Low`/`High` decimal strings of one 64-bit mask; `ViewListItems` is bit 0. Decode off by one and a plain Read grant reads back as "no access" — verify the decoder against a site admin and a known Read user |
| [CSV export executes formulas](security/csv-export-of-list-data-executes-formulas.md) | A member-written cell starting `= + - @` (or TAB/CR) runs in Excel on the reader's machine — quoting doesn't disarm it, an apostrophe prefix does |
| [An `image/*` upload accepts SVG](security/uploaded-svg-is-stored-xss.md) | SVG is a script that renders inert in `<img>` and executes on the file's direct URL — allow-list raster MIME types instead of prefix-matching |
| [App-provisioned libraries inherit the web's write permissions](security/app-provisioned-library-inherits-web-write.md) | Provisioning sets item-level permissions on lists, rarely on libraries, so any member can upload over REST and poison an AI grounded there — and `WriteSecurity: 4` does **not** fix it, because the default Members group holds Edit, which includes Manage Lists and bypasses item-level settings; only unique permissions on the library hold |
| [Breaking inheritance copies foreign Edit grants](security/breaking-inheritance-copies-foreign-edit-grants.md) | `copyRoleAssignments=true` drags another app's `Edit` groups onto your list, and `Edit` bypasses item-level security — break without copying, then prune |
| [Fewer sites and sudden 403s mean a different account](security/fewer-sites-and-403s-mean-a-different-account.md) | a tenant-wide snippet run from a second browser window executes as whoever is signed in there; print `currentuser` and the visible-site count before you blame the tenant |
| [A group created by code hides its own membership](security/group-created-by-code-hides-its-membership.md) | `sitegroups` POST defaults to `OnlyAllowMembersViewMembership: true`, so only a member or the account that ran provisioning can read the members; Full Control does not help and identical permission masks prove it |
| [URL sanitiser strips spaces](security/url-sanitiser-strips-spaces.md) | the C0 strip that blocks `java<TAB>script:` also eats the plain space, so every link to `/Shared Documents/…` 404s; strip to decide, return with `%20` |

### tooling/

| Gotcha | TL;DR |
|---|---|
| [Driving an SPFx page from the console](tooling/driving-a-spfx-page-from-the-console.md) | Setting `input.value` leaves React state empty so the form saves nothing, and `window.confirm` blocks CDP automation — both fail as success |
| [Measuring a page in a hidden tab](tooling/measuring-a-page-in-a-hidden-tab.md) | Background tabs never run `requestAnimationFrame` and clamp timers to ~1/s — the measurement times out and reads exactly like the freeze you were reproducing |
| [Diagnostics that cannot survive the crash](tooling/diagnostics-that-cannot-survive-the-crash.md) | A frozen thread stops repainting, a closed tab wipes sessionStorage, and the healthy run overwrites the crash report — three ways to get nothing from the one case you built it for |
| [Getting bulk data into a SharePoint page from the console](tooling/getting-bulk-data-into-a-sharepoint-page-from-the-console.md) | Don't paste 100+ kB and don't upload it anywhere — serve it from `127.0.0.1` with CORS; loopback is a trustworthy origin, so HTTPS pages may fetch it |
| [Git Bash mangles backslashes for native exes](tooling/git-bash-mangles-backslashes-for-native-exes.md) | `[\\/]` arrives as `[/]` — Windows-path regexes silently under-match; use `.{1,4}` or run from PowerShell |
| [Contributors panel keeps a co-author you removed](tooling/contributors-panel-stale-after-history-rewrite.md) | The REST endpoint counts authors, the panel also counts co-authors — so a "clean" API answer proves nothing; documented refresh is ~24 h, then it's a support ticket |
| [GitHub Pages certificate stuck](tooling/github-pages-certificate-stuck.md) | Domain added before DNS existed → cert never arrives — remove & re-add the domain to restart provisioning |
| [NUL byte makes grep treat a file as binary](tooling/nul-byte-makes-grep-treat-file-as-binary.md) | One raw U+0000 in a literal and every grep-based sweep silently skips the file — write the escape, detect with `file` |
| [Compiled files next to sources fake your build check](tooling/compiled-files-next-to-sources-fake-your-build-check.md) | Stale `.js` in `src/` greps like live code while nothing loads it — verify with `require.resolve`, not by reading whichever copy grep hit |
| [Word’s PDF export silently substitutes your fonts](tooling/word-pdf-export-substitutes-fonts.md) | `ExportAsFixedFormat` lays the text out in Calibri while Word still lists and embeds the font; print to PDF instead, install static (not variable) instances, and verify via the `name` table inside the embedded `FontFile2` |

## Writing your own

Use the skeleton in [CONTRIBUTING](../CONTRIBUTING.md) — one trap per file, error messages verbatim, code that fixes it.
