---
title: Reading the modern list selection from the DOM — names only, and the count lies
tags: [spfx, modern-list, dom, application-customizer, list-view-command-set]
applies-to: SharePoint Online (modern list/library view, 2026)
last-reviewed: 2026-08-13
---

# Reading which rows the user selected, from an extension that isn't a command set

> **Bottom line.** Only a `ListViewCommandSet` gets `selectedRows`. An Application Customizer can still read the selection from the DOM — but take **names only** (the file name is a `button`, not a link, so there is no path to scrape), resolve the path with one folder-scoped REST call, and get the **real count** from the "clear selection" button, because the view is virtualized and `aria-selected` only marks rendered rows.
>
> **Ve zkratce.** `selectedRows` dostane jen `ListViewCommandSet`. Application Customizer si výběr může přečíst z DOM — ale ber **jen názvy** (název souboru je `button`, ne odkaz, takže cesta tam není), cestu si doptej jedním REST čtením složky a **skutečný počet** vezmi z tlačítka „zrušit výběr": zobrazení je virtualizované a `aria-selected` nesou jen vykreslené řádky.

## Symptom

You have a floating panel injected by an Application Customizer and you want it to react to
what the user ticks in a library. `this.context` has no selection API — Application
Customizers never receive one. The obvious workaround (add a `ListViewCommandSet` that
broadcasts the selection) means changing a bundle that ships inside the `.sppkg`, which
costs an App Catalog round trip at every tenant.

## What actually works

Measured live on a modern document library (2026-08):

```js
// selected rows
document.querySelectorAll('[role="row"][aria-selected="true"]');

// file name inside a row — textContent is the clean name incl. extension
row.querySelector('[data-automationid="field-LinkFilename"]').textContent.trim();

// the selection checkbox cell, if you need to drive it in a test
// (the first one belongs to the header "select all")
document.querySelectorAll('[data-automationid^="row-selection-"]');
```

Use `textContent`, not `innerText`: `innerText` returns the text **after** `text-transform`,
so a styled view would hand you a name that never matches the server value.

## Two things that will silently break it

### 1. There is no path in the grid

The file name renders as a `button`, not an `<a href>` — the modern list opens files through
its own JS router. So `FileRef` simply is not in the DOM, and reconstructing it from
`location` is guesswork the moment the user stands in a subfolder or the library was renamed.

Resolve names against the folder the user is actually in:

```js
const lit = encodeURIComponent(folderServerRelativeUrl.split("'").join("''"));
const url = `${webUrl}/_api/web/GetFolderByServerRelativeUrl('${lit}')/Files`
  + `?$select=Name,ServerRelativeUrl,Length&$top=500`;
```

Two bonuses: `Files` returns only that folder's direct children, so the query never touches
the whole library and cannot hit the 5000-item view threshold; and selected **folders** drop
out on their own, because a folder is not a file.

Watch the size: `Length` arrives as a **string** with some header combinations and as a
number with others (the same trick `Storage` plays in `/_api/site/usage`). Always
`parseInt(String(value), 10)`.

### 2. The view is virtualized, so the count from the DOM lies

After "select all", `aria-selected="true"` sits on the few dozen **rendered** rows, not on
the whole selection. A panel that says "30 files selected" when the user selected two hundred
is worse than one that says nothing.

SharePoint reports the true number itself:

```js
const el = document.querySelector('[data-automationid="clearSelectionCommand"]');
const total = parseInt(String(el.textContent).replace(/[^0-9]/g, ''), 10) || 0;
```

Parse the **digits**, never the words — that label is localized ("7 selected",
"Vybráno: 7", …).

## Watching for changes

A `MutationObserver` filtered to `aria-selected` catches clicks instantly, but it does **not**
catch scrolling: virtualization swaps in rows that are *already* selected, so no attribute
mutation fires and the observer stays quiet. Pair it with a cheap interval (≈1 s) that
re-reads and compares a fingerprint of the selection, and emit only on a real change.

## Rule

Read the selection from the DOM if a command set is not worth its deployment cost — but treat
the DOM as a source of **display names and nothing else**, get identity and size from REST,
get the count from the control that owns it, and make every step fail-safe: if any of these
selectors ever stop matching, the feature should quietly report "no selection" rather than
break the page.
