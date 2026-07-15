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

### app-catalog/

| Gotcha | TL;DR |
|---|---|
| [Three `.sppkg` packaging pitfalls](app-catalog/sppkg-packaging-pitfalls.md) | ASCII-only solution name, icon exactly 96×96, and why the Publisher column stays empty |

### graph/

| Gotcha | TL;DR |
|---|---|
| [`/me/sendMail`: From is always the signed-in user](graph/sendmail-from-is-the-signed-in-user.md) | Delegated `Mail.Send` can't impersonate — configurable "sender" settings should govern Reply-To |

## Writing your own

Use the skeleton in [CONTRIBUTING](../CONTRIBUTING.md) — one trap per file, error messages verbatim, code that fixes it.
