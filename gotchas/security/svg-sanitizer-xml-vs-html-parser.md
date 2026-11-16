---
title: An SVG sanitiser that parses as XML is bypassed when the result is rendered as HTML
short-title: SVG sanitiser parses XML, page renders HTML
summary: "A processing instruction, comment or CDATA is one inert node to `DOMParser('image/svg+xml')` but ends early in the HTML parser – the `<img onerror>` inside wakes up; also `<style>` in inline SVG styles the whole page"
tags: [security, spfx, xss, svg]
applies-to: SharePoint Online, SharePoint Server, any web app rendering stored SVG markup
last-reviewed: 2026-11-16
---

# An SVG sanitiser that parses as XML is bypassed when the result is rendered as HTML

> **Bottom line.** Storing an icon as SVG text in a list column and rendering it with `dangerouslySetInnerHTML` is common in SPFx. If the sanitiser parses the markup with `DOMParser(…, 'image/svg+xml')` and only walks *elements*, a processing instruction, comment or CDATA section passes untouched – in XML it is one harmless node. The HTML parser that renders the result disagrees about where that node ends, and the `<img src=x onerror=…>` inside it becomes a real element. Remove every non-element, non-text node, and check the final output **in the HTML parser** before returning it.
>
> **Ve zkratce.** Sanitizace SVG v XML parseru a vykreslení přes `innerHTML` (HTML parser) se neshodnou, kde končí instrukce, komentář nebo CDATA – `<img onerror>` uvnitř se v HTML probudí. Odstraň z SVG všechny uzly kromě prvků a textu, zakaž `<style>` a výsledek zkontroluj ještě v HTML parseru.

## Symptom

Nothing visible. The sanitiser's own tests pass – they check that `<script>` and `on*` attributes disappear. Payloads like these come back unchanged:

```html
<svg xmlns="http://www.w3.org/2000/svg"><?x ><img src=x onerror=alert(1)>?></svg>
<svg xmlns="http://www.w3.org/2000/svg"><!--><img src=x onerror=alert(1)>--></svg>
```

Rendered with `innerHTML`, both execute script for every viewer of the page – often site owners and admins, while the writer only needed edit rights on one list.

## Why

- In **XML**, `<?x … ?>` is one processing instruction and `<!-- … -->` one comment, up to their real terminators. A sanitiser that iterates `getElementsByTagName('*')` never sees what is inside.
- In **HTML**, `<?x >` is a *bogus comment* that ends at the first `>`, and `<!-->` is an empty comment. What follows is parsed as markup. `img` is not an SVG element, so the HTML parser breaks out of the foreign content and creates a real `<img>` with its `onerror` handler. CDATA behaves the same way.
- Two more traps in the same code: a `<style>` inside **inline** SVG applies to the whole document, not to the icon; and `getElementsByTagName('foreignobject')` finds nothing, because tag-name matching is case-sensitive outside the HTML namespace (`foreignObject`).
- A regex "fallback" for markup that is not valid XML is worse: `<img/src=x/onerror=…>` is not well-formed XML, the fallback runs, and the slash-separated attributes slip past a pattern looking for whitespace.

## Fix

1. Strip every node that is not an element or text (processing instructions, comments, CDATA) before serialising.
2. Drop `style`, `script`, `foreignObject` and animation elements (`animate`, `set`, …); compare `localName.toLowerCase()`.
3. **Verify in the parser that will render it.** Parse the sanitised string as `text/html` and accept it only if it holds exactly one `<svg>`, every descendant is in the SVG namespace, no attribute starts with `on`, and there are no non-element, non-text nodes. Otherwise return an empty string.

```ts
function survivesHtmlParse(markup: string): boolean {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const svgs = doc.body.getElementsByTagName('svg');
  if (svgs.length !== 1 || doc.body.childNodes.length !== 1) return false;
  const walker = doc.createTreeWalker(svgs[0], NodeFilter.SHOW_ALL);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) continue;
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = n as Element;
    if (el.namespaceURI !== 'http://www.w3.org/2000/svg') return false;
    if (/^(script|style|foreignobject)$/i.test(el.localName)) return false;
    if (Array.from(el.attributes).some(a => /^on/i.test(a.name))) return false;
  }
  return true;
}
```

4. For HTML sanitisers in general, run to a **fixed point** (sanitise, re-parse, sanitise again; give up after a few rounds) – mutation XSS lives exactly in the gap between "what I cleaned" and "what the browser builds from it".
5. Test the *rendered* result: put the output through `innerHTML` (jsdom is enough) and assert that no handler fires – not that the output string lacks `<script>`. Keep one self-check case that the old sanitiser is known to fail, so the test cannot pass against a hole.

## Related

- [An image upload that accepts image/* accepts SVG](uploaded-svg-is-stored-xss.md)
- [Stored XSS from list content](stored-xss-from-list-content.md)
- [A sanitiser keeps script and style text](sanitizer-keeps-script-and-style-text.md)
