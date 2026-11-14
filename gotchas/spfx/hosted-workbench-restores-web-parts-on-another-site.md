---
title: "The hosted workbench restores your web parts on the next site you open in the same tab"
short-title: Hosted workbench restores web parts on another site
summary: The hosted workbench keeps its canvas in sessionStorage per tenant origin, not per site; open another site's workbench in the same tab and your web part boots there — with that site's pageContext, so first-run provisioning creates lists on the wrong site. Clear `sp_webpart_workbench_state` before switching sites.
tags: [spfx, workbench, provisioning, testing, sessionstorage]
applies-to: SharePoint Online (hosted workbench `_layouts/15/workbench.aspx`, SPFx web parts that provision on first run)
last-reviewed: 2026-11-14
---

# The hosted workbench restores your web parts on the next site you open in the same tab

> **Bottom line.** The hosted workbench (`/_layouts/15/workbench.aspx`) stores its canvas in `sessionStorage` under `sp_webpart_workbench_state` — without you pressing Save, and keyed by the tenant origin, not by the site. Open the workbench of *another* site in the same tab and the web parts you added before are restored and boot there, with the **new site's** `pageContext`. If your web part provisions lists on first run, it now does so on the wrong site. Clear the key (or remove the web part from the canvas, or open a fresh tab — not a duplicated one) before switching sites.
>
> **Ve zkratce.** Hostovaný workbench si plátno drží v `sessionStorage` pod klíčem `sp_webpart_workbench_state` – bez uložení a pro celý tenant, ne pro web. Když v téže kartě otevřeš workbench jiného webu, vložené webparty se obnoví a spustí s `pageContext` NOVÉHO webu. Webpart, který při prvním spuštění zakládá listy, je založí na cizím webu. Před přechodem na jiný web klíč smaž (nebo webpart z plátna odeber, případně otevři novou kartu – ne duplikovanou, ta si `sessionStorage` kopíruje).

## Symptom

You use the hosted workbench to check a web part's property pane or toolbox entry on a real site — a good place for it, because nothing is saved to a page.

Then, in the same tab, you open `/_layouts/15/workbench.aspx` on a different site to check another web part. The canvas is not empty: the web part from the first site is already there, it starts, and it shows its first-run state ("Preparing the app for first use – creating lists"). A few seconds later the second site has new lists that belong to an app that is not installed there.

## Cause

- The workbench serialises the canvas into `sessionStorage['sp_webpart_workbench_state']` as you add web parts. It does not wait for Save.
- `sessionStorage` is scoped to the origin (`https://<tenant>.sharepoint.com`) and the tab — every site in the tenant shares it.
- On load, the workbench restores that state on whatever site it is opened on. The restored web part gets the current site's `pageContext.web`.
- A "first run" gate kept in `localStorage` per site URL does not stop it: on the new site the gate has never been set, so provisioning runs.

## Fix

Before you navigate to another site's workbench in the same tab:

```js
sessionStorage.removeItem('sp_webpart_workbench_state');
```

Or delete the web part from the canvas, or open the other site in a fresh tab you start yourself (typed URL or bookmark) — a duplicated tab copies `sessionStorage`, so it carries the canvas along.

If it has already happened:

1. Leave the page so the web part stops.
2. List what was created in the last hour and check it is yours and empty:
   ```
   GET /_api/web/lists?$select=Title,Created,ItemCount&$filter=Created ge datetime'2026-11-14T00:00:00Z'
   ```
3. Only lists with `ItemCount = 0` that were created by that run go to the recycle bin (`POST /_api/web/lists(guid'…')/recycle()`), not permanent deletion.
4. Check anything else first-run provisioning touches (a central registry list, site columns, permissions).

## Related

- Provisioning that runs on every load is a separate trap; gate it, but remember the gate is per site.
