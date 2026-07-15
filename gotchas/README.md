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

### app-catalog/

| Gotcha | TL;DR |
|---|---|
| [Three `.sppkg` packaging pitfalls](app-catalog/sppkg-packaging-pitfalls.md) | ASCII-only solution name, icon exactly 96×96, and why the Publisher column stays empty |

### graph/

| Gotcha | TL;DR |
|---|---|
| [`/me/sendMail`: From is always the signed-in user](graph/sendmail-from-is-the-signed-in-user.md) | Delegated `Mail.Send` can't impersonate — configurable "sender" settings should govern Reply-To |
| [Purview Audit Query API is async](graph/purview-audit-query-api-is-async.md) | Queries run for an hour+ — attach to the last succeeded one, create in the background; v1.0 may 404 where beta works |

## Writing your own

Use the skeleton in [CONTRIBUTING](../CONTRIBUTING.md) — one trap per file, error messages verbatim, code that fixes it.
