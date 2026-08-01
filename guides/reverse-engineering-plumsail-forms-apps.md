---
title: Reverse-engineering Plumsail Forms apps for migration or audit
tags: [plumsail, forms, migration, spfx, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-08-01
---

# Reverse-engineering Plumsail Forms apps for migration or audit

> **Bottom line.** A Plumsail Forms "application" is fully readable from the site itself: every form is a JSON file in `SitePages/PlumsailForms/` containing the layout (`pcView`), the complete custom JavaScript, and the CSS. Pull those files plus the list schemas over REST and you have 100 % of the source needed to rebuild the app on another stack — no documentation required.
>
> **Ve zkratce.** Aplikace v Plumsail Forms je celá čitelná přímo z webu: každý formulář je JSON v `SitePages/PlumsailForms/` s layoutem (`pcView`), kompletním custom JavaScriptem a CSS. Stáhněte tyto soubory plus schémata seznamů přes REST a máte 100 % podkladů pro rebuild na jiném stacku – bez jakékoli dokumentace.

## Where the app actually lives

Plumsail Forms for SharePoint is a client-side product (an SPFx package). There is no server-side code and nothing hidden — a deployed "app" is the sum of:

| Piece | Where to find it |
|---|---|
| Form definitions (layout + JS + CSS) | `SitePages/PlumsailForms/*.json` files |
| Which form set a list uses, dialog/panel modes | `SitePages/PlumsailForms/forms_<List>_Item.json` |
| Pages hosting forms | Modern site pages with the **Plumsail Form web part** (`webPartId 17abc1ef-582b-4ced-96fe-a5621de1f5ec`) — read `CanvasContent1` of the page item |
| Data model | Regular SharePoint lists — read `/_api/web/lists` + `/fields` |
| List-view UX (tiles, buttons) | Standard view formatting — `CustomFormatter` property on the view |
| Business logic | Inside the `javaScript` key of each form definition (see below) |

### File naming in `SitePages/PlumsailForms/`

- `<ListName>_Item_<New|Edit|Display>.json` — the **published** form the runtime loads.
- `<ListName>_Item_<Mode>.designer.json` — the designer's source copy (near-identical; diff them to spot unpublished edits).
- `forms_<ListName>_Item.json` — small manifest: form sets, custom routing, display mode per form type (dialog/panel/full page).

### Anatomy of a form definition

```json
{
  "formId": "00000000-0000-0000-0000-000000000000",
  "pcView": "<plumsail-form>…</plumsail-form>",  // layout template (Vue-like XML)
  "tabletView": null,                             // often unused
  "phoneView": null,
  "javaScript": "window.fd = fd; …",              // ALL custom business logic
  "css": "…"
}
```

The `javaScript` value is the unminified code the maker wrote in the designer — event handlers (`fd.spRendered`, `fd.spBeforeSave`, `fd.spSaved`), PnPjs calls, toolbar customizations. This is the heart of the app; expect hardcoded list GUIDs and SharePoint group IDs inside.

The `pcView` template tells you the field layout: `fd-tabs`/`fd-tab` (tab structure), `fd-field` + `internalName` (bound fields; names starting with a designer prefix like `pf*` are usually form-only helper fields not backed by a column), `sp-datatable` (inline-editable grid over another list), `sp-plumsail-lookup`, `fd-html` (custom HTML mount points), `fd-button` with `_script` (button → global JS function).

## Extraction routine (read-only)

1. **List the definition files:**
   `GET /_api/web/GetFolderByServerRelativeUrl('/sites/yoursite/SitePages/PlumsailForms')/Files?$select=Name,Length`
2. **Download each file:**
   `GET /_api/web/GetFileByServerRelativeUrl('…/PlumsailForms/Orders_Item_Edit.json')/$value`
3. **Split each definition** into `.js`, `.css`, and `.layout.json` files locally — the JS is what you will actually read.
4. **Dump the data model:** lists (`BaseTemplate`, `ItemCount`, `Hidden`), then per-list `/fields?$filter=Hidden eq false` (types, lookups, choices, defaults) and `/views` (watch for `CustomFormatter` — tile catalogs and custom buttons live there, not in Plumsail).
5. **Find the hosting pages:** site pages' `CanvasContent1` (HTML-encoded JSON) names the web part and its properties — including which list, which mode, and a fixed `itemId` when a Display form is used as a pseudo-page.
6. **Read navigation** (`/_api/web/navigation/quicklaunch`) — it usually reveals the intended screen map.

## Patterns to expect (seen in the wild)

- **Dummy-item pages**: a list with a single item whose Display form (hosted via the web part with `itemId: 1`) serves as a whole custom page — e.g. a shopping cart or dashboard. The list itself carries no data.
- **New-form-as-console**: an admin console built as a *New* form that is never saved — buttons call global JS functions that do all writes via PnPjs.
- **Client-side "workflow"**: status transitions, stock decrements, denormalized aggregates (rating averages) all done from the browser with read-then-write PnPjs calls. There is **no locking** — flag every such spot as a race-condition risk in your migration notes.
- **UI-only security**: admin buttons gated by `pnp.sp.web.currentUser.groups` checks against a hardcoded group ID. That is cosmetics, not a boundary — any user with list permissions can do the same writes via REST. Decide explicitly whether the rebuild keeps or fixes this.
- **State in `localStorage`**: per-browser state (carts, drafts) that users may believe is saved server-side.

## Migration checklist derived from the extract

- [ ] Every list + field mapped (note lookups by ID vs by Title, calculated fields, denormalized columns)
- [ ] Every form's JS read end-to-end; business rules written out as plain-language spec
- [ ] View `CustomFormatter` JSON captured (tile layouts, row actions)
- [ ] Hosting pages + navigation mapped to target screens
- [ ] Hardcoded GUIDs / group IDs inventoried (they break on any re-provisioning)
- [ ] Race conditions and UI-only security decisions listed as explicit rebuild choices
- [ ] Asked the owner what lives *outside* the site: Power Automate flows, scheduled jobs, e-mail notifications — the form JS won't show those

## Notes

- Everything above is readable with ordinary user permissions on the site (the runtime itself must read the definitions), so an account with read access to `SitePages` suffices for extraction; writes are never needed.
- Definition files are versioned like any library file — version history can recover older logic.
- If your tooling pipes page content through a DLP-ish filter, expect GUID-dense JS to trip it; downloading the raw files and reading them locally avoids fighting the filter.
