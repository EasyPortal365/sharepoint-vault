---
title: "A shared component's var() fallback chain is only as good as its last link"
tags: [spfx, react, css, design-system]
applies-to: SharePoint Online (SPFx web parts sharing a component library)
last-reviewed: 2026-07-26
---

# A shared component's var() fallback chain is only as good as its last link

> **Bottom line.** When you move a component into a shared library and reach for the host's design tokens with `var(--token, …)`, the *terminal* fallback is what actually renders in any app that never defines those custom properties — so make it your brand value, never `sans-serif`/`monospace`.
>
> **Ve zkratce.** Když komponentu přesuneš do sdílené knihovny a saháš na tokeny hostitele přes `var(--token, …)`, v každé appce, která ty custom properties vůbec nedefinuje, se vykreslí **koncový** fallback – ať je to tedy brandová hodnota, nikdy `sans-serif`/`monospace`.

## Symptom

You extract `Pagination`, `SortableTable`, a command palette and a page header into a shared npm package. Two or three web parts adopt it. `tsc`, ESLint, unit tests and the webpack build are all green.

Then someone sends a screenshot: **table headers and the command palette render in the browser's default serif font**, while everything around them is on-brand. Colours may be off too. Nothing in any log.

## Cause

Shared components typically read the host's tokens defensively, with a fallback chain that tries both naming conventions:

```tsx
fontFamily: 'var(--ep-font-mono, var(--ep-fm, monospace))'
```

That looks safe, and it covers two classes of host. It does **not** cover the third: apps that never publish font tokens as CSS custom properties at all. In SPFx that's common — a web part can't put tokens on `:root` without leaking into the page and colliding with other web parts, so teams either scope them (`.app-root { --ep-ft: … }`) or skip CSS variables entirely and keep tokens as TypeScript constants applied through inline styles:

```ts
// tokens.ts — perfectly normal SPFx pattern
export const tokens = { text: '#002163', fontBody: "'Plus Jakarta Sans', sans-serif" };
```

In that app **no link of the chain resolves**, and the browser falls through to the terminal fallback — `monospace`, or worse `sans-serif`, which on Windows is not what your brand font looks like. The chain that was supposed to make the component portable is exactly what hides the problem: it always produces *something*.

Two aggravating details:

- **This is not the portal trap.** A portaled overlay also escapes root-scoped tokens ([separate gotcha](portaled-overlays-miss-your-css-reset.md)), but here a table header rendered *inside* the app root broke too. Fixing portals does not fix this.
- **The defect replicates to every consumer** the moment they adopt the package, and nobody notices, because "slightly wrong font" doesn't look like a bug — it looks like a font that hasn't loaded yet.

## Fix

Put the brand stacks in one module in the package and make them the terminal fallback:

```ts
// fonts.ts
export const FONT_TEXT = "'Plus Jakarta Sans', 'Segoe UI', sans-serif";
export const FONT_MONO = "'JetBrains Mono', Consolas, monospace";

// long convention → short convention → brand stack
export const FF_TEXT = `var(--ep-font-body, var(--ep-ft, ${FONT_TEXT}))`;
export const FF_MONO = `var(--ep-font-mono, var(--ep-fm, ${FONT_MONO}))`;
```

```tsx
import { FF_MONO } from './fonts';
<th style={{ fontFamily: FF_MONO }}>…</th>
```

A `var()` fallback may itself be a comma-separated font list, so `var(--x, 'JetBrains Mono', Consolas, monospace)` is valid CSS — the whole list becomes the fallback.

## Notes

- **Why the build can't help you.** CSS custom properties resolve at *runtime*. An unresolved token isn't an error, it's an empty value with a silent browser fallback. Type checking, linting, unit tests and bundling are all blind to it by construction. The only detection is looking at the rendered page.
- **Readiness test before migrating a component.** Ask how the target app publishes tokens. If it uses TS constants rather than CSS custom properties, adopting the shared component **will** change its appearance — the app must emit `--*` on its root, or the component must accept the values as props. Check this before the migration, not after the screenshot.
- **When you find this class of bug, audit every consumer of the package**, not just the app that reported it. The pilot app that first adopted the component usually has it too.
- Same reasoning applies to any token the component reaches for — colours, radii, line colours. Brand-correct terminal defaults everywhere; a component should look right in an app that publishes *nothing*.
