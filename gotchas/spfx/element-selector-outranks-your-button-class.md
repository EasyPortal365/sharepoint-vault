---
title: "An element selector outranks your button class — and only a themed tenant sees it"
tags: [spfx, css, theming, accessibility]
applies-to: SharePoint Online (SPFx web parts, any scoped-root stylesheet)
last-reviewed: 2026-08-13
---

# An element selector outranks your button class

> **Bottom line.** `.app-root a { color: inherit }` (0,0,1,1) beats `.btn--accent { color: var(--on-accent) }` (0,0,1,0), so a link styled as a button inherits the surrounding text colour instead of its own. With your default palette the two colours are nearly identical and nobody notices — the bug surfaces only on a tenant whose accent needs *white* label text. Exclude component classes from the blanket rule: `.app-root a:not(.btn)`.
>
> **Ve zkratce.** `.app-root a { color: inherit }` má vyšší specificitu než `.btn--accent`, takže odkaz stylovaný jako tlačítko zdědí barvu okolního textu místo své vlastní. U výchozí palety je rozdíl neznatelný, takže si toho roky nikdo nevšimne — projeví se až u zákazníka, jehož akcent potřebuje BÍLÝ popisek. Obecné pravidlo omez: `.app-root a:not(.btn)`.

## Symptom

On a tenant with a custom (dark) accent, some buttons render with dark, barely legible labels —
but only the ones that happen to be links: "Open link", "Email", "Download". The identical-looking
`<button>` next to them is fine.

Everything else about theming works, which is what makes this confusing: the background *is* the
customer's colour, so the theme clearly applies. Only the text on it is wrong.

## Why

A scoped stylesheet almost always contains a base rule like this:

```scss
.app-root a { color: inherit; text-decoration: none; }   /* 0,0,1,1 */
```

and separately, a button system:

```scss
.btn--accent  { background: var(--accent); color: var(--on-accent); }   /* 0,0,1,0 */
.btn--primary { background: var(--primary); color: #fff; }              /* 0,0,1,0 */
```

`.app-root a` is *class + element*, which outranks a lone class. So for
`<a class="btn btn--accent">` the `color` declaration that wins is `inherit` — the label picks up
whatever colour the surrounding text has, usually your dark body colour.

**Why it hides for years:** with a light default accent, `--on-accent` is a dark brand colour too.
`inherit` and the intended value land within a few percent of each other, so the button looks
correct. Only a theme dark enough to require white label text separates them — by which point the
code has been shipped for a long time and the regression looks like it arrived with the theme
feature.

The same trap applies to any blanket element rule inside a scoped root: `.app-root button { … }`,
`.app-root input { … }`, `.app-root h2 { … }`.

## Fix

Take component classes out of the blanket rule's reach, rather than patching each site:

```scss
.app-root a { text-decoration: none; }          /* keep what should be universal */
.app-root a:not(.btn) { color: inherit; }       /* colour only for non-button links */
```

`:not(.btn)` takes the specificity of its argument, so the rule is now (0,0,2,1) — still strong, but
it no longer *matches* button links at all, letting `.btn--accent` apply.

Patching individual call sites with an inline `color` also works, but leaves the next
`<a class="btn …">` anyone adds to fall into the same hole.

## Find every instance

```bash
# links styled as buttons
grep -rEn '<a[^>]*class(Name)?="[^"]*\bbtn\b' src/
# blanket element rules inside your scoped root
grep -rEn '\.app-root (a|button|input)\s*\{' src/
```

## Check it without a themed tenant

Force the situation in the console on any page — set the token that supplies the label colour to
white and see whether the button follows:

```js
document.documentElement.style.setProperty('--on-accent', '#fff');
```

If the `<button>` turns white and the `<a class="btn">` next to it does not, you have this bug.
`getComputedStyle(el).color` plus the rule list in DevTools' Styles pane confirms which selector won.

## See also

- [A theme override on your app root can't reach tokens declared on :root](theme-override-cant-reach-root-declared-tokens.md)
  — the other reason a custom palette only half applies.
