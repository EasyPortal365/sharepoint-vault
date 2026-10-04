---
title: Putting an Image web part on a modern page via REST — the control JSON that renders, with a link
short-title: Image web part via REST (canvas JSON)
summary: "Out-of-the-box Image web part (`d1d91016-…`) in `CanvasContent1`: file ids in `properties` + `customMetadata`, the URL in `serverProcessedContent.imageSources`, the click target in `links.linkUrl`; works in a full-width section and in columns"
tags: [rest-api, sitepages, pages, canvas, web-parts]
applies-to: SharePoint Online (communication site, verified 2026-10-04)
last-reviewed: 2026-10-04
---

# Putting an Image web part on a modern page via REST — the control JSON that renders, with a link

> **Bottom line.** You can build a good-looking landing page entirely through REST with the out-of-the-box **Image** web part: upload the pictures to Site Assets, then put one control per picture into `CanvasContent1`. The file identity goes into `properties` *and* `serverProcessedContent.customMetadata`, the server-relative URL into `serverProcessedContent.imageSources.imageSource`, and the click target into `serverProcessedContent.links.linkUrl`. Verified live: it renders in a full-width section (`sectionFactor: 0`) and in a three-column section, and the whole picture is a link.
>
> **Ve zkratce.** Pěknou rozcestníkovou stránku jde složit čistě přes REST z OOTB webové části **Obrázek**: obrázky nahrát do Prostředků webu a za každý dát do `CanvasContent1` jeden prvek. Identita souboru patří do `properties` *i* do `serverProcessedContent.customMetadata`, URL do `imageSources.imageSource` a cíl kliknutí do `links.linkUrl`. Ověřeno naostro v sekci přes celou šířku i ve třech sloupcích; celý obrázek je odkaz.

## Why bother

The "nice" out-of-the-box web parts (Hero, Quick links) have large, undocumented JSON — written from memory they tend to render empty. The Image web part is small, and if you **render the cards yourself** (text, colours, button baked into a PNG) you get full visual control without any SPFx package. Put the real wording into `altText` so screen readers and search still get it.

## The control

```js
const img = (file, link, alt, position) => {
  const id = crypto.randomUUID();
  return {
    controlType: 3, id, position, emphasis: {}, addedFromPersistedData: true,
    webPartId: 'd1d91016-032f-456d-98a4-721247c305e8',
    webPartData: {
      id: 'd1d91016-032f-456d-98a4-721247c305e8', instanceId: id,
      title: 'Image', description: 'Image', dataVersion: '1.11',
      properties: {
        imageSourceType: 2, altText: alt, overlayText: '', captionText: '', alignment: 'Center',
        fileName: file.name, siteId: file.siteId, webId: file.webId, listId: file.listId,
        uniqueId: file.uniqueId, imgWidth: file.w, imgHeight: file.h, fixAspectRatio: false
      },
      serverProcessedContent: {
        htmlStrings: {}, searchablePlainTexts: { captionText: '' },
        imageSources: { imageSource: file.serverRelativeUrl },   // '/sites/x/SiteAssets/card.png'
        links: link ? { linkUrl: link } : {},                     // absolute URL is fine
        customMetadata: { imageSource: { siteId: file.siteId, webId: file.webId, listId: file.listId,
          uniqueId: file.uniqueId, width: String(file.w), height: String(file.h) } }
      }
    }
  };
};
```

- `siteId` = `/_api/site?$select=Id`, `webId` = `/_api/web?$select=Id`, `listId` = `/_api/web/GetList('<web>/SiteAssets')?$select=Id`, `uniqueId` = the `UniqueId` returned by `Files/AddUsingPath`.
- Layout: banner `position: { zoneIndex: 1, sectionIndex: 1, controlIndex: 1, sectionFactor: 0, layoutIndex: 1 }` (full width — communication sites only); cards `zoneIndex: 2, sectionIndex: 1..3, sectionFactor: 4`.
- End the array with the usual `controlType: 0` page-settings slice and save it with create → `SavePageAsDraft` → `Publish` ([three-step page creation](create-modern-page-via-rest-sitepages.md)). `PageLayoutType: 'Home'` drops the title area, so the banner is the first thing on the page.

## Generating the pictures in the browser

You don't need an image tool: draw the cards on a `<canvas>` in the SharePoint page itself (`ctx.fillText`, `roundRect`, a few polygons for a brand motif), `canvas.toBlob(r, 'image/png')`, and POST the blob to
`/_api/web/GetFolderByServerRelativePath(decodedurl='<web>/SiteAssets')/Files/AddUsingPath(decodedurl='card.png',overwrite=true)`.
Call `POST /_api/web/lists/EnsureSiteAssetsLibrary` first — a fresh site may not have the library yet. Use 2× the display size (e.g. 1200×780 for a one-third column) so the text stays sharp.

## Gotchas met on the way

- **`moveto` does not overwrite** with `flags=0` — HTTP 400 "file already exists". Recycle the old page first (`…/GetFileByServerRelativePath(…)/recycle`), then rename.
- **A `$expand=Author` on `ListItemAllFields` via `GetFileByServerRelativePath` failed** where the same call without the expand worked — the guard that depended on it silently skipped the recycle. Keep pre-checks to plain `$select`.
- After the rename, re-save with `checkoutpage` → `SavePageAsDraft` (new `Title`) → `Publish`; `SavePageAsDraft` checks the page in, so a direct `SavePage` returns 409.
