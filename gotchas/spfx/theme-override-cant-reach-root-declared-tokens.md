---
title: "A theme override on your app root can't reach tokens declared on :root"
tags: [spfx, css, theming, react]
applies-to: SharePoint Online (SPFx web parts)
last-reviewed: 2026-08-13
---

# A theme override on your app root can't reach tokens declared on `:root`

> **Bottom line.** A custom property is substituted on the element where it is *declared*, not where it is used — so writing `--brand: red` on your web part's root div never recomputes `--text: var(--brand)` declared on `:root`; that one resolved on `:root` and inherits down already-baked. Write the override on `document.documentElement`.
>
> **Ve zkratce.** CSS proměnná se vyhodnotí na elementu, kde je DEKLAROVANÁ, ne kde se používá – zápis `--brand: red` na kořenový div webpartu tedy nikdy nepřepočítá `--text: var(--brand)` deklarovaný na `:root`; ten se vyhodnotil na `:root` a dolů se dědí už hotová barva. Override zapisuj na `document.documentElement`.

## Symptom

A tenant theme applies *partially*. Accent-coloured chrome (buttons, badges, kickers) picks up the
customer's colour, but headings, dark buttons and KPI figures stay in your product's default brand
colour. Panels and dialogs stay default entirely.

The tempting conclusion — "the theme record is missing a value" — is wrong. Log what the app
resolved: the override object contains the right colour, and the app applied it. It still doesn't show.

## Why

Semantic tokens are usually derived in a stylesheet:

```scss
:root {
  --brand-700: #002163;
  --text: var(--brand-700);     /* substituted HERE, on :root */
  --hook: var(--brand-700);
  --ui-text: var(--text);       /* aliases for a shared component package */
}
```

and the override is applied as an inline style on the web part's root element:

```tsx
<div className={styles.appRoot} style={{ '--brand-700': theme.primary }}>
```

Custom properties are substituted **at computed-value time on the element carrying the
declaration**. `--text` is declared on `:root`, so it resolves against `:root`'s `--brand-700`
(`#002163`) and what inherits downward is the finished colour, not the `var()` expression.
An override on a descendant has nothing left to recompute.

What survives is only what a component reads **directly** — `var(--accent)` written in an inline
style *is* evaluated on that element, so it sees the override. Hence the giveaway pattern:
**the accent inherits, everything derived does not.**

## Fix

Write the override where the derived tokens are declared — the root element:

```tsx
React.useLayoutEffect(() => {
  const root = document.documentElement;
  const keys = Object.keys(vars);
  for (let i = 0; i < keys.length; i++) root.style.setProperty(keys[i], vars[keys[i]]);
  return () => {
    for (let i = 0; i < keys.length; i++) root.style.removeProperty(keys[i]);
  };
}, [vars]);
```

`useLayoutEffect` runs before paint, so there is no flash of the default palette. The cleanup
matters on SharePoint: SPA navigation unmounts the web part, and a stale override on `<html>`
would outlive it.

The alternative — moving the whole semantic-token block out of `:root` into your app-root class —
works too, but see the portal note below before choosing it.

### This also fixes portals, and that's the bigger half

React portals (`createPortal(node, document.body)`) are a standard way to escape SharePoint's
stacking contexts for panels, overlays and command palettes. They render **outside** your app root,
so an override scoped to that root misses them completely — panels don't just lose derived colours,
they lose the accent too. Scoping the tokens to an app-root class has the same blind spot and, worse,
leaves a trap for the next portal someone adds. `document.documentElement` covers every subtree at once.

If your tokens are unprefixed (`--text`, `--accent`), putting them on `:root` does share them with
the whole page — but a stylesheet that already declares them under `:root` is doing that anyway, so
this changes nothing about the blast radius. Prefix your tokens if that bothers you.

## Check it without deploying

In the console, compare what the app *thinks* it applied with what an element actually computes:

```js
getComputedStyle(document.documentElement).getPropertyValue('--brand-700'); // the override
getComputedStyle(document.querySelector('h1')).color;                      // what really renders
```

Different values mean the substitution never reached the derived token.

## Related trap: hand-picked shades don't derive themselves

Brand scales (`--brand-100` … `--brand-900`) are usually chosen by eye, not computed. If hover state
reads `--brand-500` and you only inherit `--brand-700`, a customer with a non-blue primary gets a
hover that jumps to your original hue. When you make a token inheritable, walk every token that was
hand-derived from it and derive those too (lighten/darken from the inherited value, keeping the
original constant when the primary equals your default).

## Related trap: a colour written as a literal is unreachable, fix or no fix

After the override lands correctly, some elements can *still* show your default palette — typically
avatar and icon gradients:

```scss
.avatar--g1 { background: linear-gradient(135deg, #003599, #00CED7); }
```

No token is involved, so no amount of fixing the token chain touches it. This is worth knowing
because the failure looks identical to the substitution bug above, and it is easy to spend a
diagnostic round re-checking the theme record and the service that reads it. Before you suspect the
inheritance chain, **grep your stylesheets and JS colour maps for literal brand hexes**.

The fix is to derive those shades in the same resolver that produces the rest of the palette
(`--avatar-g1: linear-gradient(135deg, <primary>, <accent>)`) and consume them with the original
value as a fallback:

```scss
.avatar--g1 { background: var(--avatar-g1, linear-gradient(135deg, #003599, #00CED7)); }
```

The fallback keeps the default look byte-for-byte when no theme is set and during the async window
before the theme is fetched — so the change is invisible to every existing tenant.

**Draw a line around what you derive.** Derive shades that are your *product's default branding*.
A colour the user explicitly picked for a record (a green category, an amber label) is a stored
decision — recolouring it from the theme silently overrides the choice its author made.

## See also

- [An element selector outranks your button class](element-selector-outranks-your-button-class.md) —
  the theme applies, but the label on it is unreadable.
- [Portaled overlays miss your CSS reset](portaled-overlays-miss-your-css-reset.md) — same
  outside-the-root blind spot, hitting `box-sizing` instead of colours.
- [A shared component's var() fallback chain is only as good as its last link](shared-component-var-fallback-lands-on-system-font.md)
  — the other way themed components silently render unthemed.
