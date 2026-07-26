---
title: A non-web protocol in a formatter `href` silently drops the whole element
tags: [lists, column-formatting, view-formatting, security]
applies-to: SharePoint Online
last-reviewed: 2026-07-26
---

# A non-web protocol in a formatter `href` silently drops the whole element

> **Bottom line.** Formatting sanitizes `href` values — an anchor whose computed URL uses an application protocol like `ms-word:` is not just neutralized, the element is removed **with all its children**, so entire cards or cells vanish with no error; open-in-desktop-app belongs to `customRowAction: "openContextMenu"`, not to a link.
>
> **Ve zkratce.** Formátování sanitizuje hodnoty `href` – odkaz, jehož vypočtená URL používá aplikační protokol typu `ms-word:`, se nejen zneškodní, ale odstraní se celý element **včetně všech potomků**, takže beze stopy zmizí celé karty či buňky; otevření v desktopové aplikaci patří do `customRowAction: "openContextMenu"`, ne do odkazu.

## Symptom

A gallery card (or a formatted cell) contains an "Open in app" link built with the Office URI scheme:

```jsonc
{
  "elmType": "a",
  "attributes": {
    "href": "=if([$File_x0020_Type] == 'docx', 'ms-word:ofe|u|', if([$File_x0020_Type] == 'xlsx', 'ms-excel:ofe|u|', '')) + 'https://contoso.sharepoint.com' + [$FileRef]"
  }
}
```

After deploying, items whose expression produces the `ms-word:` / `ms-excel:` / `ms-powerpoint:` prefix render as **blank cards** — not a broken link, not a missing icon, the entire element tree is gone. Items where the expression yields a plain `https://` URL (here: PDFs, which got the empty prefix) render normally. There is no console error and the formatter itself saves and reads back fine.

That per-item split is the diagnostic tell: the same JSON, some rows fine, some rows empty, and the difference correlates exactly with what the `href` expression evaluates to.

## Cause

Attribute values in list formatting are sanitized at render time. `href` accepts ordinary web URLs; an application protocol fails that validation and SharePoint's reaction is to drop the element — including every child — rather than render the anchor without the attribute. Because the `href` is an expression, the drop is evaluated **per item**, which is why only some rows disappear.

## Fix

Don't fight the sanitizer. For "open in desktop app", delegate to the native context menu, which has *Open in app* built in:

```jsonc
{
  "elmType": "button",
  "attributes": { "title": "More actions" },
  "customRowAction": { "action": "openContextMenu" },
  "children": [ { "elmType": "span", "attributes": { "iconName": "MoreVertical" } } ]
}
```

Keep real links strictly on web URLs — open in browser and download are safe:

```jsonc
{ "elmType": "a", "attributes": { "href": "[$FileRef]", "target": "_blank" } }
{ "elmType": "a", "attributes": { "href": "=[$FileRef] + '?download=1'" } }
```

## Notes

- Deploy risky attribute changes on **one** element first. Because the failure mode is silent removal, a bad `href` shipped to every card looks like a completely broken view and sends you hunting in the wrong places (schema, `tileProps`, CSS) before you suspect a link.
- The same wholesale-drop behaviour is worth assuming for any attribute the sanitizer dislikes — treat "element missing, no error" as an attribute-validation symptom.
- Related: [Gallery cards render from `tileProps`](gallery-cards-render-from-tileprops.md) — the other way a card goes blank with no error.
