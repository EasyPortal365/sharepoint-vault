---
title: "Two \"Uncaught (in promise)\" from sp-pages-assembly on a modern page are SharePoint's own, not your web part"
summary: On SharePoint Online modern pages the console can show two "Uncaught (in promise)" exceptions with reason undefined and a stack only inside sp-pages-assembly, on every load and on SPA navigation – they also appear on a page with no custom code at all, so prove it with an A/B against such a page before you debug your own loader or web part; a page whose application customizer hides the SharePoint chrome may not show them, which makes "only some of my apps have it" look like a bug in those apps
tags: [spfx, console, debugging, sp-pages-assembly, unhandledrejection, diagnostics]
applies-to: SharePoint Online modern site pages (measured November 2026, sp-pages-assembly_1_en-us_d03e5cd3…, SPFx 1.22.2 web parts)
last-reviewed: 2026-11-11
---

# Two "Uncaught (in promise)" from sp-pages-assembly on a modern page are SharePoint's own

> **Bottom line.** Before you spend time on two `Uncaught (in promise)` exceptions whose reason is `undefined` and whose stack sits only inside `sp-pages-assembly_*.js`, load a modern page on a site with **no custom code** (only out-of-the-box web parts) and read the console the same way. On the tenant where this was measured both exceptions appeared there too, at the same line and column. They are SharePoint noise, not your web part.
>
> **Ve zkratce.** Dvě výjimky „Uncaught (in promise)“ s důvodem `undefined` a stackem jen v `sp-pages-assembly` nejdřív porovnej se stránkou webu bez vlastního kódu. Tam se objevily také, na stejném řádku i sloupci. Jsou to výjimky SharePointu, ne tvého webpartu.

## Symptom

After a release you check the console on several sites that run your SPFx web parts:

- on some sites the console is clean;
- on others it shows, on every page load and again on in-app (SPA) navigation:

```
Uncaught (in promise)
    at <anonymous> (…/sp-client/sp-pages-assembly_1_en-us_<hash>.js:384:29687)
    at <anonymous> (…/sp-client/sp-pages-assembly_1_en-us_<hash>.js:169:70370)
```

An `unhandledrejection` listener shows `event.reason === undefined`, and no frame of your bundle appears in the stack. Because the clean sites run the same loader template, it looks like something specific to the noisy apps.

## Cause

The rejections are raised inside SharePoint's page assembly. The measured A/B:

| Page | Custom code on the page | Exceptions |
|---|---|---|
| Home page of a team site with only the default list web part | none | 2× at `384:29687` |
| Home page of a site with one SPFx web part (runtime loader) | one web part | 2× at `384:29687` |
| Home page of a site with one SPFx web part **and** an application customizer that hides the SharePoint chrome | web part + customizer | none |

The third row is why "only some apps" look affected. *Assumption, not measured further:* the code that rejects belongs to page chrome that the hiding customizer suppresses.

## Fix

Nothing to fix in your code. Make the A/B part of the routine:

1. Open a modern page on a site with no custom solutions and reload it with the console open (console capture in automation tools often starts only after the first read, so reload after you attach).
2. Compare file name, line and column of the exceptions. Same location = SharePoint's.
3. Only a frame from your own bundle, or a reason that is your error object, is worth debugging.

```js
// paste before reload (or as early as your tool allows) to see the reasons
window.__rej = [];
addEventListener('unhandledrejection', e => window.__rej.push({ reason: String(e.reason), stack: e.reason && e.reason.stack }));
```

## See also

- [Microsoft Learn – Debug SharePoint Framework solutions in Visual Studio Code](https://learn.microsoft.com/sharepoint/dev/spfx/debug-in-vscode)
