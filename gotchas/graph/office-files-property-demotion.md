---
title: Office files change their content hash when you PATCH metadata — property demotion
short-title: "Office files: property demotion changes the hash"
summary: Metadata PATCH and copy jobs rewrite Office file bytes; key change detection on `lastModifiedBy`, never compare sizes exactly
tags: [graph, files, sharepoint-online, automation, migration, copy-job]
applies-to: SharePoint Online (Microsoft Graph / REST)
last-reviewed: 2026-10-31
---

# Office files change their *content hash* when you PATCH metadata — property demotion

> **Bottom line.** Your own metadata PATCH changes an Office file's `cTag` and even its content hash (property demotion writes properties into the bytes), so hash/cTag skip checks reprocess forever — key the skip on `lastModifiedBy.application.id` instead.
>
> **Ve zkratce.** Tvůj vlastní PATCH metadat změní u Office souboru `cTag` i content hash (property demotion zapíše vlastnosti přímo do bajtů), takže přeskakování podle hashe/cTagu zpracuje soubor pořád dokola – klíčuj přeskočení podle `lastModifiedBy.application.id`.

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

## Copy jobs do it too — file sizes differ after a library-to-library copy

Measured on a real migration (October 2026): a `CreateCopyJobs` copy of a 794-file library to another site finished cleanly and every file arrived, yet a size check said the total was off by −13 kB. Only Office files differed (23 of them: docx, pptx, xlsx), and the deltas were **constant per source library and content type** (−1001, −126, +141 bytes). PDFs, images and everything else matched to the byte.

Opening both ZIPs and comparing parts by CRC showed the content parts (`word/document.xml`, slides, sheets, media) were identical. Only metadata parts changed:

| Part | What changed |
|---|---|
| `customXml/item*.xml` (content type schema) | replaced by the **target** library's schema (13,863 → 8,178 bytes in our case) |
| `customXml/item*.xml` (property values) | values for columns the target doesn't have dropped (e.g. image tags, `TaxCatchAll`) |
| `customXml/itemProps*.xml` | new datastore GUIDs |
| `docProps/custom.xml` | `ContentTypeId` of the target library + empty properties added (`Order`, `xd_Signature`, `TemplateUrl`, `_SourceUrl`, …) |
| `docProps/core.xml` | an empty `<dc:title>` added |

So a copy job does not copy Office files byte for byte — SharePoint demotes the target library's schema into them on arrival.

**Consequences for migration checks:**

- Never compare `File/Length` of Office files exactly between source and target. Compare file presence and count exactly; for OOXML extensions, treat a small size delta (we allow up to 64 kB — schema size grows with the number of library columns) as metadata, and report it as such instead of "size mismatch".
- Keep exact comparison for non-Office files and flag any Office delta beyond the threshold — a truncated or failed copy shows up as a whole-file difference, not hundreds of bytes.
- To prove content integrity of an Office file, compare the CRCs of its content parts from the ZIP central directory, not the file hash or length.
