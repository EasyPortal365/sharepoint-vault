---
title: View formatting drops CSS gradients — use a solid background-color
tags: [lists, view-formatting, column-formatting, css]
applies-to: SharePoint Online (column and view formatting)
last-reviewed: 2026-09-24
---

# View formatting drops CSS gradients — use a solid `background-color`

> **Bottom line.** List formatting accepts a fixed allowlist of style properties. `background` is not on it, and a `linear-gradient(…)` in `background-image` did not survive in our tests either — so an element whose legibility depends on a gradient, such as a white initial on a gradient avatar, renders as white on white. Give every coloured element a solid `background-color`.
>
> **Ve zkratce.** Formátování seznamů přijímá pevný seznam povolených stylových vlastností. `background` na něm není a `linear-gradient(…)` v `background-image` v našich testech také nepřežil – prvek, jehož čitelnost stojí na přechodu, třeba bílá iniciála na avataru s přechodem, se proto vykreslí bíle na bílém. Každému barevnému prvku dej plnou `background-color`.

## Symptom

A gallery or row formatter shows people as round avatars with a white initial on a two-colour gradient. In the list, the circle is transparent and the white letter sits on a white row — invisible.

## Cause

The `style` object of a formatter accepts only a documented list of style attributes. `background-color` and `background-image` are on it; the `background` shorthand is not. A gradient did not render through either property in our tests, so the element was left without any background.

## Fix

```json
"style": {
  "background-color": "=if([$Role] == 'Lead', '#0f6cbd', '#107c10')",
  "color": "#ffffff"
}
```

Let colour carry meaning through a solid `background-color`, computed per item if you like, and never let legibility depend on a decoration.

## Notes

- Check the allowlist before you reach for a CSS property you know from the web: [Formatting syntax reference — `style`](https://learn.microsoft.com/en-us/sharepoint/dev/declarative-customization/formatting-syntax-reference#style).
- Iterating on a formatter over REST? Judge each version in a fresh tab: [A formatter renders empty in the tab you are iterating in](formatter-renders-empty-in-your-working-tab.md).
