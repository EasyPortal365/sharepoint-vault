# ✂️ Snippets

Small, self-contained fragments to copy straight into your solution — each with a two-line intro saying when to reach for it.

## Index

### rest/

| Snippet | When to reach for it |
|---|---|
| [Read all items from a large list — paging done right](rest/get-all-list-items-paged.md) | Any list past a few thousand items: `$top` caps at 5,000, `$skip` is ignored — follow `odata.nextLink` |
| [Find externally / anonymously shared content via Search](rest/find-externally-shared-content-search.md) | Oversharing / Copilot-readiness audit: `ViewableByExternalUsers:1` surfaces files shared out, security-trimmed, one query |

### cli/

| Snippet | When to reach for it |
|---|---|
| [SPO Management Shell one-liners](cli/spo-management-shell-one-liners.md) | Quick admin answers — storage top 20, external sharing, deleted sites, lock state — no script file needed |

## Planned categories

`caml/` (CAML query building blocks) · `list-formatting/` (column and view formatting JSON)
