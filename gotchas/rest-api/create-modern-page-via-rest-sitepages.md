---
title: Creating a modern page via REST is a three-step dance, not one POST
short-title: Create a modern page via REST (3-step)
summary: "`CanvasContent1` won't stick on create; create → SavePageAsDraft → Publish, canvas is JSON; plain JSON is enough, `Description` needs its own write and a re-publish; the file name is random — rename with moveto"
tags: [rest-api, sitepages, pages, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-09-26
---

# Creating a modern page via REST is a three-step dance, not one POST

> **Bottom line.** Creating a modern page is a three-call sequence — create, `SavePageAsDraft` (where `CanvasContent1` actually lands, as a JSON canvas-control string), then `Publish` — not a single POST.
>
> **Ve zkratce.** Moderní stránka vzniká sekvencí tří volání – create, `SavePageAsDraft` (sem `CanvasContent1` reálně patří, jako JSON řetězec s canvas prvky) a `Publish` – ne jedním POSTem.

## Symptom

You POST a new modern page and expect content plus a published page from one call:

```
POST /_api/sitepages/pages
{ "Title": "Quarterly update", "CanvasContent1": "<...>" }
```

…and you get a page that is **blank**, stuck **in draft**, or a **400/500**. The `CanvasContent1`
you sent at create time is ignored, and the page never shows up as published.

## Cause

The `SitePages` OData set models a page as an entity with an explicit **draft → publish
lifecycle**. Creation, content, and publishing are **three separate operations**:

1. **Create** the page entity — you get back an `Id`, but no content.
2. **`SavePageAsDraft(Id)`** — this is where `CanvasContent1` actually lands.
3. **`Publish(Id)`** — flips the draft into a published page.

`CanvasContent1` is also not free-form HTML: it is a **JSON string** describing canvas
controls. A text block is `controlType: 4` with its markup in `innerHTML`, followed by a
trailing `controlType: 0` settings slice. Get the shape wrong and the page renders empty
even when the call returns 200.

## Fix

Run the three steps in order. Every call uses `Accept: application/json;odata=nometadata`
and a JSON `Content-Type`:

```ts
const base = `${webUrl}/_api/sitepages/pages`;
const json = { 'Content-Type': 'application/json', 'Accept': 'application/json;odata=nometadata' };

// 1) Create — returns the page Id (and AbsoluteUrl/Url)
const created = await sp.post(base, SPHttpClient.configurations.v1, {
  headers: json,
  body: JSON.stringify({ Title: title, PageLayoutType: 'Article' })
});
const page = await created.json();            // { Id, AbsoluteUrl, Url, ... }
const id = page.Id;

// 2) SavePageAsDraft — CanvasContent1 lands HERE, as a JSON string
await sp.post(`${base}(${id})/SavePageAsDraft`, SPHttpClient.configurations.v1, {
  headers: json,
  body: JSON.stringify({ Title: title, CanvasContent1: buildCanvas(html) })
});

// 3) Publish
await sp.post(`${base}(${id})/Publish`, SPHttpClient.configurations.v1, { headers: json });
```

The canvas builder — one text web part carrying your HTML:

```ts
function buildCanvas(html: string): string {
  return JSON.stringify([
    {
      controlType: 4,                         // 4 = text
      id: newGuid(),                          // any fresh GUID
      position: { controlIndex: 1, sectionIndex: 1, zoneIndex: 1, sectionFactor: 12, layoutIndex: 1 },
      emphasis: {},
      displayMode: 2,
      innerHTML: html,                        // your rendered HTML goes here
      editorType: 'CKEditor'
    },
    { controlType: 0, pageSettingsSlice: { isEnabledOnConsumerSites: true, isEnabledOnPublishing: true } }
  ]);
}
```

## Measured: plain JSON is enough, and `Description` is its own problem

A live A/B test (2026-09-24, SharePoint Online, two pages run through the same sequence, every value read back from `_api/sitepages/pages(<id>)` and from the library item):

| Step | Plain JSON (no `__metadata`, `OData-Version: 4.0`) | Verbose (`__metadata`, `'odata-version': ''`) |
|---|---|---|
| `POST …/pages` with `Title` | 201, `Title` saved | 201, `Title` saved |
| `SavePageAsDraft` (`Title`, `Description`, canvas) | 200, `Title` and body saved | 200, `Title` and body saved |
| `SavePage` after `checkoutpage` | 204, `Title` and body saved | 200, `Title` and body saved |
| `Description` sent in the body | **not saved** — derived from the text | **not saved** — derived from the text |

- **You don't need `odata=verbose` for these endpoints.** Both variants store the same things; the plain one also worked with `Content-Type: application/json;odata=nometadata`.
- **`SavePageAsDraft` checks the page in.** A `SavePage` right after it fails with **409** *"We cannot save your changes because a site member has ended your editing session"* — call `POST …/pages(<id>)/checkoutpage` first.
- **`Description` does not come from the save calls.** SharePoint derives it from the first text web part, even with `isDefaultDescription: false` in the settings slice, and every later `SavePage` derives it again. A list-item MERGE of `Description` returned **204 without storing it**. `ValidateUpdateListItem` with `bNewDocumentUpdate: false` does store it — but on a library with minor versions it lands in a **new minor version** (1.0 → 1.1, a draft), while the published version keeps the derived text. **Publish again after it** (1.1 → 2.0, verified), or readers who cannot see drafts never get your summary. `bNewDocumentUpdate: true` fails with **500** *"Additions to this Web site have been blocked."*
- On a library with minor versions the same applies to any other column you set on the page item after `Publish` — a plain MERGE also moved the page from 2.0 to 2.1 — so whatever you write there lives in the draft until the next publish.
- **What readers see.** Measured on a live intranet (2026-09-24): news pages whose summary and category column were written after `Publish`/`PromoteToNews` carried them only in minor versions x.1–x.3. Readers saw the description derived from the body and empty custom columns; the author, who sees drafts, saw everything. A read-back with an editor account therefore proves nothing — write the properties **before** publishing (or publish again after the last write) and report success only after checking the **published** major version, as a reader or in the version history.

## Notes

- **Treat Publish as best-effort.** If step 3 fails after steps 1–2 succeeded, the page
  exists as a **draft** — surface its URL and let the user publish it manually rather than
  discarding the work. The open URL is on the create response (`AbsoluteUrl`, or make `Url`
  absolute yourself).
- **`innerHTML` is rendered as-is.** If any of it is user- or AI-authored, sanitize before it
  goes on the page — this is a stored-content surface.
- **Links must be real anchors.** `<a href="https://contoso.sharepoint.com/...">` renders
  clickable; bare text or `[label](url)` markdown does not — convert markdown to HTML *before*
  building the canvas.
- **`controlType`**: `4` = text, `3` = client-side web part, `0` = the page settings slice
  (always include it). Section and column layout live in each control's `position`.
- **The file name is random, not your title.** Measured 2026-09-26: `POST …/pages` with
  `Title: "Centrum"` created `SitePages/8g6wqn5n.aspx`. If the URL matters (navigation, links
  you hand out), rename right after publishing:
  `POST /_api/web/GetFileByServerRelativePath(decodedurl='/sites/x/SitePages/8g6wqn5n.aspx')/moveto(newurl='/sites/x/SitePages/Centrum.aspx',flags=0)`
  — the page keeps its content and title.
- **Placing an existing SPFx web part on a new page** is easiest by cloning its control from a
  page where it already sits (`_api/sitepages/pages(<id>)?$select=CanvasContent1` returns the
  JSON form): give the copy a fresh GUID in both `id` and `webPartData.instanceId`, adjust
  `webPartData.properties`, and use `sectionFactor: 0` for a full-width section (communication
  sites). The list-item field `CanvasContent1` of the same page is **HTML**, not JSON — read the
  pages endpoint, not the library item.
- **Don't retry a timed-out script blindly.** A multi-page setup script that outlived the
  caller's timeout still finished in the browser; re-running it would have created every page a
  second time. Read the current state first (list pages and their web parts), then act.
- Delegated and unremarkable on permissions: it runs as the signed-in user and needs only
  contribute on the target site — no elevation, no app-only.
