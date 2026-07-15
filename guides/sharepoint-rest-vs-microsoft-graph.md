---
title: SharePoint REST vs Microsoft Graph — which API for which job
tags: [rest-api, graph, architecture, guide]
applies-to: SharePoint Online, Microsoft Graph
last-reviewed: 2026-07-16
---

# SharePoint REST vs Microsoft Graph — which API for which job

Every SharePoint solution eventually talks to both APIs. The mistake is treating them as interchangeable — they overlap on maybe a third of their surface, and each owns territory the other can't reach. This is the decision map we actually use.

## 1. The one-table answer

| You need… | Use | Why |
|---|---|---|
| List items CRUD, list/field management | **SP REST** | Full fidelity: field types, `$expand` projections, list formatting, content types. Graph's `/lists` API is a subset |
| Cross-site, security-trimmed content queries | **SP REST search** | [KQL + managed properties](search-queries-that-actually-work.md); Graph search exists but SPO-specific features lag |
| Files as *documents in libraries* (metadata, versions, check-in/out) | **SP REST** | Library semantics live here; see [file size via `$expand=File`](../gotchas/rest-api/file-size-needs-expand-file.md) |
| Files as *drive items* (thumbnails, preview URLs, delta sync, sharing links) | **Graph** `/drives` | The drive facet is Graph-native and genuinely better for these |
| Mail, calendar, To Do, Teams messages | **Graph** | No SP REST equivalent exists — mind [`sendMail` From rules](../gotchas/graph/sendmail-from-is-the-signed-in-user.md) |
| User profiles, group membership, directory roles | **Graph** | `/me`, `/users`, `/groups` — mind the [directory-vs-profile PATCH split](../gotchas/graph/patch-me-directory-vs-profile-fields.md) |
| People search for a picker | **SP REST search** (People source) | [The pattern that works in SPFx](../gotchas/spfx/people-search-endpoints-that-work.md); Graph `/users` filtering is fine for admin UIs |
| Tenant-wide site enumeration | **Graph `getAllSites`** — but [app-only](../gotchas/graph/tenant-wide-enumeration-is-app-only.md) | SP REST has no untrimmed enumeration at all; search is trimmed |
| Usage/activity reporting | **Graph reports** — server-side only ([CORS](../gotchas/graph/usage-reports-cors-blocked-in-browser.md)) | SP-side alternatives: `/_api/site/usage`, search analytics properties |
| Audit log | **Graph** audit queries — [asynchronous by design](../gotchas/graph/purview-audit-query-api-is-async.md) | — |

## 2. Auth is the real difference in SPFx

- **SP REST** through `SPHttpClient`: zero setup, user context, works the moment your web part loads. Cross-web within the tenant included.
- **Graph** through `MSGraphClientV3` / `AadHttpClient`: every scope goes into `webApiPermissionRequests` in `package-solution.json` and waits for **tenant-admin approval** in the SP admin center. Design for the unhappy path: consent not granted yet, [token still carrying old scopes after approval](../gotchas/graph/usage-reports-cors-blocked-in-browser.md), and scopes that exist but [don't support delegated tokens](../gotchas/graph/tenant-wide-enumeration-is-app-only.md).

Rule of thumb: **if SP REST can do the job with acceptable fidelity, it wins in SPFx by default** — not because it's better, but because it ships without an approval dependency and works for every user on day one.

## 3. Where people pick wrong

1. **"Graph is the modern one, let's use it for lists"** — then they hit missing field-type fidelity, no formatting, weaker `$expand`, and rewrite to SP REST anyway. Graph's list support is for light-touch scenarios.
2. **"SP REST for files everywhere"** — and then hand-roll thumbnails and preview links that Graph's `driveItem` gives for free. Split by *capability*, not by loyalty.
3. **"One token, one client for everything"** — SP REST and Graph fail differently (throttling headers, error shapes, OData dialects). Wrap them separately; a shared "http helper" that half-understands both is how [wire-format 400s](../gotchas/rest-api/metadata-body-requires-verbose.md) stay undiagnosed for a week.
4. **Deciding by docs instead of by permissions table** — a Graph endpoint's *existence* says nothing about whether your token type may call it. Check Delegated vs Application **before** writing code; it's the difference between an afternoon and [a deploy-and-revert cycle](../gotchas/graph/tenant-wide-enumeration-is-app-only.md).

## 4. Throttling — same tenant, different budgets

Both APIs throttle (429 + `Retry-After`), but on separate buckets. Practical consequences:

- Respect `Retry-After` verbatim; don't invent your own backoff below it.
- Batch where it matters: Graph has `$batch` (20 requests); SP REST batching exists but is finicky — often the better "batch" is a smarter single query (`$expand`, [search](search-queries-that-actually-work.md), paged reads).
- A hybrid page that hammers both APIs on load should stagger them — the user perceives one app; the platform meters two.

---

*Every claim above earned its place by breaking something first. Corrections welcome — see [CONTRIBUTING](../CONTRIBUTING.md).*
