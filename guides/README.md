# 🧭 Guides

End-to-end walkthroughs that connect the dots — the "how it all fits together" layer above scripts and snippets.

## Index

| Guide | What it covers |
|---|---|
| [Calling SharePoint REST like a pro](calling-sharepoint-rest-like-a-pro.md) | The client landscape, headers that matter, safe writes, reading well, field/list creation quirks, and a ten-minute diagnosis routine |
| [Search queries that actually work](search-queries-that-actually-work.md) | The one mandatory header, practical KQL, managed properties (`RefinableString*`), paging/sorting, and the freshness/trimming traps |
| [SharePoint REST vs Microsoft Graph](sharepoint-rest-vs-microsoft-graph.md) | A decision table by capability, the SPFx auth difference, common wrong picks, and throttling budgets |
| [Choosing a knowledge format for RAG](choosing-a-knowledge-format-for-sharepoint-rag.md) | Markdown vs DOCX vs site pages vs list items — extraction quality, token economics, and the author-here-publish-Markdown pattern |
| [Token cost of content formats (measured)](token-cost-of-sharepoint-content-formats.md) | Real numbers: the same article as `.md`/`.docx`/`.pdf`/a SharePoint page — why extraction, not format, drives the token bill; plus a CZ-vs-EN language tax and a reproducible harness |

## Planned next

- **SPFx from zero to App Catalog** — scaffolding, debugging, packaging, deployment paths

Have a guide you'd like to see? [Open an issue](https://github.com/EasyPortal365/sharepoint-vault/issues).

## Format

`kebab-case.md` with frontmatter — see [CONTRIBUTING](../CONTRIBUTING.md). Task-oriented: each guide takes the reader from A to B, not through the whole alphabet.
