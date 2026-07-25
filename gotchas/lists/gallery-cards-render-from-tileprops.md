---
title: Gallery cards render from `tileProps`, not from `formatter`
tags: [lists, document-library, view-formatting, gallery, pnp-powershell]
applies-to: SharePoint Online
last-reviewed: 2026-07-25
---

# Gallery cards render from `tileProps`, not from `formatter`

> **Bottom line.** In a document library's Gallery view the card is built from a nested `tileProps.formatter`; the top-level `formatter` of the tile-formatting schema is ignored, so a hand-written tile formatter silently renders as the stock card — put your design in `tileProps.formatter` and switch the view with `ViewType2 = "TILES"`.
>
> **Ve zkratce.** V zobrazení Galerie v dokumentové knihovně se karta staví z vnořeného `tileProps.formatter`; kořenový `formatter` z tile-formatting schématu se ignoruje, takže ručně psaný tile formatter se tiše vykreslí jako výchozí karta – návrh patří do `tileProps.formatter` a zobrazení se přepíná přes `ViewType2 = "TILES"`.

## Symptom

You author tile formatting against the documented schema, push it to a document library view, and nothing you designed appears. There is no error — the formatter saves, reads back byte-identical, and the view renders the stock card (thumbnail, file name, modified date).

The failure changes shape depending on one unrelated property, which makes it read like a layout bug:

| `ViewType2` | `CustomFormatter` | Rendered |
|---|---|---|
| *(empty)* | tile formatting JSON | plain list — as if no formatter existed |
| `TILES` | tile formatting JSON | stock gallery card — as if no formatter existed |

Chasing it through the CSS property allowlist, `TabularView`, or the size fields changes nothing, because none of them is the cause.

## Cause

The library's Gallery layout is driven by `ViewType2 = "TILES"` alone — a gallery with **no** `CustomFormatter` at all renders the stock card perfectly well. That is the first surprise: the default tiles are a built-in mode, not a default template you are overriding.

The second is that the card design lives one level deeper than the schema suggests. What the in-product *Document card designer* writes is:

```jsonc
{
  "$schema": "https://developer.microsoft.com/json-schemas/sp/v2/tile-formatting.schema.json",
  "height": 250, "width": 250, "hideSelection": false, "fillHorizontally": true,
  "formatter": { /* present, valid, and never rendered */ },
  "tileProps": {
    "height": 696, "width": 254, "hideSelection": false, "fillHorizontally": true,
    "formatter": { /* THIS is the card */ }
  }
}
```

`tileProps` is not in the published tile-formatting schema, so writing to the documented top-level `formatter` looks correct and fails quietly. Both keys can coexist — the top-level one is simply dead weight.

## Fix

Set the layout and put the design in `tileProps.formatter`:

```powershell
# 1) layout - the formatter alone will not switch a view to gallery
Set-PnPView -List $listId -Identity 'Gallery' -Values @{ ViewType2 = 'TILES' }

# 2) the card itself
Set-PnPView -List $listId -Identity 'Gallery' -Values @{ CustomFormatter = $json }
```

Build the card on the product's own structure rather than from scratch — the classes carry the click target, hover, selection and keyboard behaviour, and `filepreview` gives a real document thumbnail that an `<img>` pointed at `getpreview.ashx` will not match:

```jsonc
{
  "elmType": "div",
  "attributes": { "class": "sp-card-container" },
  "children": [
    { "elmType": "div",
      "attributes": { "class": "sp-card-defaultClickButton" },
      "customRowAction": { "action": "defaultClick" } },
    { "elmType": "div",
      "attributes": { "class": "ms-bgColor-white sp-css-borderColor-neutralLight sp-card-borderHighlight sp-card-subContainer" },
      "children": [
        { "elmType": "div",
          "attributes": { "class": "sp-card-previewColumnContainer" },
          "children": [
            { "elmType": "div",
              "attributes": { "class": "sp-card-imageContainer" },
              "children": [
                { "elmType": "filepreview",
                  "attributes": { "src": "@thumbnail.512x432" },
                  "style": { "height": "170px" },
                  "filePreviewProps": {
                    "fileTypeIconClass": "sp-fileTypeIcon-cardDesigner",
                    "brandTypeIconClass": "sp-brandTypeIcon-cardDesigner" } } ] } ] }
      ] }
  ]
}
```

Column display names are available as `[!InternalName.DisplayName]`, which is how the designer renders its field labels.

## Notes

- **Read the product's own output before designing.** Create a gallery view in the UI, edit the card once in the designer, then read `CustomFormatter` back over REST. That one round trip answers questions no amount of schema-reading will.
- Column formatting does **not** carry into cards — a Choice column with a coloured pill formatter shows as plain text in the designer's card. Re-implement the visual inside `tileProps.formatter`.
- An extra `div` injected as the first child of `sp-card-subContainer` (a coloured status stripe, say) flashes on load and then disappears once the product's own CSS settles. Put the colour on the container itself with an inline `border-top-*` instead — an inline style outranks the class.
- Accent colours belong on `border-top-width`/`-style`/`-color` as separate properties; expression-driven shorthand is easy to get wrong and harder to debug.
- Related: [View formatting JSON can't contain `<` or `&`](view-formatter-rejects-angle-bracket-and-ampersand.md) — the same view formatter is also subject to that restriction.
