---
title: "A PDF built in the browser shows Czech characters, but copy-paste returns garbage and the QR payment is rejected"
short-title: Client-side PDF with an embedded TTF subset and a Czech QR payment (SPAYD)
summary: Embedding a TrueType subset into a hand-written PDF works without a library if you zero unused glyphs instead of renumbering, keep composite components, and always add a ToUnicode CMap; the Czech QR Platba (SPAYD) string has strict rules – CZK only, AM with a dot, uppercase ASCII, `*` escaped – and must round amounts exactly like your other invoice export
tags: [spfx, pdf, fonts, truetype, qr, invoice, czech]
applies-to: SPFx web parts (or any browser code) generating PDF documents client-side
last-reviewed: 2026-11-19
---

# A PDF built in the browser shows Czech characters, but copy-paste returns garbage and the QR payment is rejected

> **Bottom line.** You can write a small PDF 1.7 generator yourself (Type0 / CIDFontType2, `Identity-H`, `FontFile2`) and skip a several-hundred-kB library. Three things decide whether it works: subset the font by **zeroing** unused glyphs (keep glyph IDs, keep components of composite glyphs), always ship a **ToUnicode CMap**, and load the font as a **static TTF** (WOFF2 cannot be embedded). For a Czech QR payment (SPAYD), follow the Czech Banking Association spec literally and compute the amount with the same rounding as your other invoice export.
>
> **Ve zkratce.** PDF jde v prohlížeči napsat vlastním malým zapisovačem (Type0 / CIDFontType2, `Identity-H`, `FontFile2`) bez knihovny o stovkách kB. Rozhodují tři věci: podmnožinu písma dělat **nulováním** nepoužitých glyfů (ID zůstanou, komponenty složených glyfů se berou s sebou), vždy přidat **ToUnicode CMap** a písmo načítat jako **statické TTF** (WOFF2 vložit nejde). U QR Platby (SPAYD) se držet standardu ČBA doslova a částku počítat stejným zaokrouhlením jako druhý export faktury.

## Why it bites

- The PDF base fonts (WinAnsi) have no `ě ř š ž ů`. You need an embedded font, and the obvious route – a PDF library plus a font engine – adds hundreds of kB to a bundle that every user downloads.
- Converting RTF/DOCX to PDF on the server (SharePoint/OneDrive `?format=pdf`) is great for plain documents, but the server substitutes fonts it does not have and you lose control over exact layout – not good enough for an invoice with a QR code.

## What works

1. **Subset by zeroing, not renumbering.** Keep `glyf` entries only for used glyph IDs and give every other glyph a zero-length `loca` range. Glyph IDs stay the same, so `cmap`, `hmtx` and `CIDToGIDMap Identity` need no rewrite.
2. **Keep composite components.** Many accented letters are composites (`ř` = `r` + caron). Walk the component list of every kept glyph, otherwise the accent renders as nothing.
3. **Always add `ToUnicode`.** Without it the page *looks* right, but copy-paste, search and any document reader on the receiving side get nonsense.
4. **Load the font lazily as static TTF** from your CDN with CORS, only when the user asks for the PDF. WOFF2 is compressed and usually variable – it cannot go into `FontFile2`.
5. **Compress with `CompressionStream('deflate')`** (zlib format, which is what `FlateDecode` expects); fall back to an uncompressed but valid file if it is missing.

## QR Platba (SPAYD) rules that get violated

- `SPD*1.0*` header, `ACC` = IBAN (optionally `+BIC`), `AM` with a **dot** and two decimals, max. 9 999 999.99.
- `CC` – the spec allows **only CZK**. Do not put EUR invoices into a QR Platba code; say so on the document instead.
- Texts (`MSG` max 60, `RN` max 35) uppercase, without diacritics (keeps the QR in alphanumeric mode); `*` inside a value must be `%2A`. `X-VS` digits only, max 10.
- **Verify by decoding the rendered PDF** (render a page, read the QR with a decoder, parse the result), not by comparing strings in a unit test.
- **Round like your other export.** If your XML e-invoice rounds each VAT bucket's base to whole crowns and the PDF sums raw bases, the QR asks for a different amount than the XML (a line of 9 001.50 CZK is enough). Test both outputs against each other.

## Related

- [DecompressionStream and trailing bytes in PDF streams](decompressionstream-trailing-bytes-pdf-streams.md)
