---
title: A formatter renders empty in the tab you are iterating in — verify in a fresh tab
tags: [lists, view-formatting, caching, rest-api]
applies-to: SharePoint Online (view and column formatting applied over REST)
last-reviewed: 2026-09-24
---

# A formatter renders empty in the tab you are iterating in

> **Bottom line.** When you apply one formatter version after another to a view over REST, the tab you are working in can start rendering even valid formatters as empty — after a reload too — while a brand-new tab renders the very same JSON. In our case, most of what looked like a corrupted view was this client-side state. Judge every version in a fresh tab (one tab, one version), iterate on a scratch view, and keep formatters simple on a list that drops rich ones even in a fresh tab.
>
> **Ve zkratce.** Když přes REST nasazuješ na pohled jednu verzi formatteru za druhou, pracovní tab začne i platné formattery vykreslovat prázdně – i po obnovení stránky –, zatímco úplně nový tab tentýž JSON vykreslí. U nás byla většina toho, co vypadalo jako poškozený pohled, právě tenhle stav na straně klienta. Každou verzi posuzuj v čerstvém tabu (jeden tab, jedna verze), iteruj na pomocném pohledu a na seznamu, který bohatý formatter shazuje i v čerstvém tabu, drž formatter jednoduchý.

## Symptom

You are tuning a gallery or row formatter by writing `CustomFormatter` (and toggling `ViewType2`) on the same view from a script. After a dozen or so rounds the cards come up blank. A trivial formatter still renders, the rich one does not, going back to an earlier version that worked does not help, and the view's properties show nothing unusual. It looks as if the repeated writes have corrupted the view.

## Cause

Mostly they have not. The working tab keeps client-side state about the view, and after many changes it renders valid formatters as empty — even after a reload. Opened in a completely new tab, the same formatter renders.

Not all of it is the tab, though. On some lists a rich formatter renders empty even in a fresh tab — expression-valued styles built from deeply nested `=if`, nested action blocks, several info rows — while the JSON parses fine and a minimal formatter renders.

## Fix

- **One tab, one formatter version.** After each write, open the list in a new tab before you judge the result.
- **Iterate on a scratch view**, not on the view people use, and apply the final formatter to the real view in one clean write.
- **Keep formatters simple where a list is fragile:** solid colours, no deep `=if` chains.
- The diagnostic signal: *rich renders empty, minimal renders, the same formatter works elsewhere* → the view or the tab, not your JSON.

## Notes

- The formatter is stored in the view's schema XML, which has its own trap: [View formatting JSON can't contain `<` or `&`](view-formatter-rejects-angle-bracket-and-ampersand.md).
- Gallery cards need two separate writes: [Gallery cards render from `tileProps`](gallery-cards-render-from-tileprops.md).
