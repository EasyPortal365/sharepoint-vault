---
title: "Hand-built .docx / .pptx: the parts Office demands even though they do nothing"
tags: [spfx, ooxml, docx, pptx, export, jszip, testing]
applies-to: SPFx / any browser JavaScript
last-reviewed: 2026-08-28
---

# Hand-built .docx / .pptx: the parts Office demands even though they do nothing

> **Bottom line.** Generating Office files client-side with JSZip is a few hundred lines and needs no new dependency — but the package is validated as a whole. A header image referenced from the wrong `.rels`, a missing `<Default Extension="png">`, a namespace declared on the document instead of the header, or a `.pptx` without a theme and a slide master: each one produces the same useless message, *"the file is corrupt"*, with no hint which part is at fault. Split the package assembly from the zipping so the parts can be asserted and run through a real XML parser in a unit test.
>
> **Ve zkratce.** Skládat Office soubory v prohlížeči přes JSZip jde bez nové závislosti, ale balíček se ověřuje jako celek. Obrázek odkázaný z nesprávného `.rels`, chybějící `<Default Extension="png">`, namespace deklarovaný na dokumentu místo na hlavičce nebo `.pptx` bez motivu a předlohy — všechno skončí toutéž hláškou „soubor je poškozen" bez nápovědy, co konkrétně. Odděl skládání částí od zipování, ať jdou části testovat a prohnat skutečným XML parserem.

## The traps, in the order they bite

### 1. A header image is referenced from the header's own rels

The relationship for an image used in `word/header1.xml` belongs in **`word/_rels/header1.xml.rels`** — not in `word/_rels/document.xml.rels`, where the hyperlink and style relationships live. Each part carries its own relationships; `r:embed="rIdLogo"` is resolved against the rels of the part that uses it.

### 2. `[Content_Types].xml` must know the image extension

```xml
<Default Extension="png" ContentType="image/png"/>
```

Without it the package contains a part of unknown type, which is a package-level error — the document itself may be flawless.

### 3. Namespaces are per part, not inherited

`w:hdr` needs its own `xmlns:r` and `xmlns:wp` declarations before it can hold a `w:drawing`. Nothing is inherited from `document.xml`. The same applies to the math namespace `xmlns:m` when a document contains OMML.

### 4. A `.pptx` is not just slides

A presentation that opens reliably needs, at a minimum:

```
[Content_Types].xml
_rels/.rels
ppt/presentation.xml            + ppt/_rels/presentation.xml.rels
ppt/slideMasters/slideMaster1.xml + its .rels
ppt/slideLayouts/slideLayout1.xml + its .rels
ppt/theme/theme1.xml
ppt/slides/slideN.xml           + one .rels per slide
```

The master, the layout and the theme can be almost empty — but they must exist, and the master must reference the layout while the layout references the master. A presentation with **zero** slides is also invalid, so an empty input needs one blank slide rather than an empty `sldIdLst`.

### 5. Vector logos do not belong in a Word header

SVG is not rendered dependably in a header. Skipping the image and falling back to text is better than shipping a document with a broken picture in the corner of every page.

## Make it testable: parts first, zip second

```ts
/** The whole package as a map of path → XML. Zipping is a separate, trivial step. */
export function buildPptxParts(slides, style): { [path: string]: string } { /* … */ }

export async function buildPptxBlob(slides, style): Promise<Blob> {
  const zip = new JSZip();
  const parts = buildPptxParts(slides, style);
  Object.keys(parts).forEach(p => zip.file(p, parts[p]));
  return zip.generateAsync({ type: 'blob', mimeType: '…presentationml.presentation' });
}
```

That one split buys three kinds of test that need neither a browser nor Office:

* **completeness** — every required path is present, and a slide announced in `[Content_Types].xml` actually exists;
* **reference integrity** — every `r:id` used in `presentation.xml` exists in `presentation.xml.rels`;
* **well-formedness** — pipe every part through a strict SAX parser. This is what catches an unescaped `&` in a customer's company name, or a colour value like `modrá` reaching an `srgbClr val` attribute.

For the Word side the same check can go one better: build the real blob, unzip it and validate what actually came out — the strongest available proof short of opening the file in Word.

```js
const parser = sax.parser(true);            // strict
let err = null;
parser.onerror = e => { err = e.message; parser.resume(); };
parser.write(xml).close();
```

## Escape everything, and refuse impossible values

Every text node needs XML escaping, and control characters forbidden in XML 1.0 (`U+0000–08`, `0B`, `0C`, `0E–1F` — typically pasted from a PDF) must be stripped rather than escaped. Colours are worth validating separately: an attribute like `val="modrá"` is well-formed XML and still corrupts the file, so a value that fails `/^[0-9A-F]{6}$/` should fall back to a neutral default instead of being written out.
