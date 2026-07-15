---
title: Office files change their content hash when you PATCH metadata — property demotion
tags: [graph, files, sharepoint-online, automation]
applies-to: SharePoint Online (Microsoft Graph / REST)
last-reviewed: 2026-07-16
---

# Office files change their *content hash* when you PATCH metadata — property demotion

## Symptom

A scheduled job processes documents and stamps a result into their metadata (a column, a marker). To skip unchanged files it compares `cTag` — or, being clever, the content hash (`file.hashes.quickXorHash`). Either way, the same documents get reprocessed **every single run, forever**.

## Cause

Two separate traps stacked on top of each other:

1. **`cTag` changes with *any* item update** — including your own metadata PATCH. The moment you stamp your result, you've invalidated your own skip condition.
2. The obvious fix — compare the **content hash** instead — fails specifically for **Office formats** (docx/xlsx/pptx): SharePoint writes document properties *into the file* (**property demotion**, the modern echo of the old Office server-side properties sync). Your metadata PATCH physically rewrites bytes inside the file, so `quickXorHash` changes too.

Net effect: from the pipeline's point of view, every document it touches "changed".

## Fix

Don't derive "did *someone else* change it?" from generic change indicators. Use actor identity:

1. **Primary skip:** your own marker (timestamp/state column) **plus** `lastModifiedBy.application.id === <your app's client id>` — if the last writer was you, nothing external happened since your stamp.
2. Content hash only as a **secondary** safety net for non-Office files, where metadata writes don't touch the binary.

```ts
const item = await graph.get(`/drives/${driveId}/items/${itemId}?$select=lastModifiedBy,listItem`);
const lastAppId = item.lastModifiedBy?.application?.id;
if (alreadyStamped(item) && lastAppId === MY_CLIENT_ID) { return; } // nothing new — skip
```

## Notes

- Diagnostic rule that would have saved us a round: when a scheduled function "runs hot" on the same items, first check whether **its own write negates its own skip condition**.
- `eTag` behaves like `cTag` for this purpose — both are item-version indicators, not "content changed by someone else" indicators.
- PDF and image files don't get property demotion — which makes the bug intermittent-looking if your library mixes formats. All the more reason to key on `lastModifiedBy`.
