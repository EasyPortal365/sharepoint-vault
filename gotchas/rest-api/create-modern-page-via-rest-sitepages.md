---
title: Creating a modern page via REST is a three-step dance, not one POST
tags: [rest-api, sitepages, pages, spfx]
applies-to: SharePoint Online
last-reviewed: 2026-07-15
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
- Delegated and unremarkable on permissions: it runs as the signed-in user and needs only
  contribute on the target site — no elevation, no app-only.
