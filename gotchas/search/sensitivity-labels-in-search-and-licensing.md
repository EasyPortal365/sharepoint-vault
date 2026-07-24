---
title: Sensitivity labels in SharePoint Search — the managed property works, but licensing gates it
tags: [search, kql, purview, sensitivity-labels, licensing, governance]
applies-to: SharePoint Search REST (/_api/search/query), Microsoft Purview Information Protection, KQL
last-reviewed: 2026-07-24
---

# Sensitivity labels in SharePoint Search — the managed property works, but licensing gates it

> **Bottom line.** `InformationProtectionLabelId` *is* a queryable/retrievable managed property, but it only returns a GUID after AIP integration is enabled **and** the file is actually labeled **and** re-crawled. And on tenants without an Information Protection licence you can't even *create* a label (`InvalidLicenseException`) — the "free" Purview trial requires buying E3 first. If you need "exclude this from AI/search" governance on a mixed-licence estate, don't build it on Purview.
>
> **Ve zkratce.** `InformationProtectionLabelId` je dotazovatelná/retrievable managed property, ale GUID vrací až po zapnutí AIP integrace, skutečném oštítkování souboru a reindexaci. A na tenantu bez Information Protection licence nevytvoříš ani štítek (`InvalidLicenseException`) – „bezplatný" Purview trial chce nejdřív koupit E3. Governance „nedávat do AI/hledání" na smíšených licencích proto nestav na Purview.

## Symptom

You want to find, filter, or exclude documents by their Microsoft Purview **sensitivity label** from
SharePoint Search — e.g. a RAG assistant that must skip anything labeled "Confidential". You try two things
and both disappoint:

1. You add `InformationProtectionLabelId` to `selectproperties` (or `InformationProtectionLabelId:<GUID>`
   to the KQL) and every row comes back with an **empty** label — even documents you're sure are labeled.
2. You open the Purview portal to create a test label and the wizard fails on **Create** with
   `Microsoft.Exchange.Management.UnifiedPolicy.InvalidLicenseException — This tenant is not licensed to be
   able to run this operation, you can start a trial…`. The "start a trial" path then tells you to **purchase
   Office 365 E3 / Microsoft 365 E3 first** (trial activates 3–5 days *after* purchase).

## Cause

Two independent gates:

- **The managed property is real but conditional.** `InformationProtectionLabelId` is a built-in managed
  property (queryable + retrievable). It's populated only when: (a) sensitivity labels for Office files in
  SharePoint/OneDrive are turned on (`Set-SPOTenant -EnableAIPIntegration $true`, or the Purview portal
  "Turn on now" banner), (b) the file is **actually labeled** (Office on the web / the Sensitivity column /
  a label policy), and (c) it's been **re-crawled**. Before all three, the column selects fine but is blank —
  which reads as "the property doesn't work" when it's really "nothing to return yet".
- **Creating/applying labels needs a licence.** Manual labeling ships with M365/O365 **E3+** (Business
  Premium); auto-labeling needs E5. On Business Standard/Basic the portal lets you *navigate* the label UI
  but throws `InvalidLicenseException` the moment you commit. The self-service Purview Suite trial is **not**
  freely available — its prerequisite is an existing E3-level base plan.

## Fix

- **Confirm the licence first, live.** Try creating a throwaway label in the Purview portal. If it saves, you
  have labeling; if it throws `InvalidLicenseException`, you don't — stop planning around Purview.
- **If you have the licence:** enable integration and label a couple of test files, then confirm the property:

  ```powershell
  Set-SPOTenant -EnableAIPIntegration $true          # SPO Management Shell (Global admin)
  Get-Label | Format-Table Name, Guid, ContentType   # Security & Compliance PowerShell — the GUIDs
  ```

  Then in KQL (needs `odata-version: 3.0`, see the sibling gotcha):

  ```
  InformationProtectionLabelId:8faca7b8-8d20-48a3-8ea2-0f96310a848e
  ```

  Allow up to 24 h for label-policy propagation and a re-crawl before troubleshooting an empty column.
- **If you don't (mixed estate, SMB):** build the governance signal yourself — a plain **Choice** site column
  (a small classification vocabulary, one value meaning "excluded"), read it per-item or map it to a managed
  property. It works on every licence, and it's honest about scope: a label read from search is **not a
  security boundary** anyway (the user still has SharePoint permissions to the file), so a self-managed flag
  is exactly as strong for "keep it out of the AI's source material".

## Why it's easy to miss

- The portal renders the whole labeling UI on an unlicensed tenant — the wall is only at **Create**, so a
  quick click-through looks like it'll work.
- An empty `InformationProtectionLabelId` looks identical whether the property is unavailable, the tenant
  hasn't enabled AIP integration, or the file simply isn't labeled yet. Probe with a file you *know* is
  labeled after a crawl, not with a fresh upload.
- Docs describe the *capability* ("search by sensitivity label") without foregrounding the licence + enable +
  crawl prerequisites, so the design assumption ("we'll just read the label") survives until deployment.

## See also

- `gotchas/rest-api/search-api-needs-odata-version-3.md` — the header the label query also needs.
- `gotchas/security/field-hiding-is-not-a-permission.md` — same principle: a label/flag read client-side is governance, not a security boundary.
- `gotchas/rest-api/choice-fields-accept-any-value.md` — if you roll your own Choice classification, REST won't enforce the vocabulary.
