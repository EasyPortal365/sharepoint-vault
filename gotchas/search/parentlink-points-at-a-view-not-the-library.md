---
title: Search ParentLink points at a library view, not at the library
short-title: "`ParentLink` from Search points at a library view"
summary: Often `…/Forms/AllItems.aspx`, so used as a path it empties a `Path:` filter and can send a save into `Forms` while a `GetList` probe still passes; normalize on read and on write
tags: [search, rest-api, urls, libraries]
applies-to: SharePoint Online (Search REST results)
last-reviewed: 2026-09-24
---

# `ParentLink` from Search points at a library *view*, not at the library

> **Bottom line.** For a document in a library, the `ParentLink` of a search result often ends in a view page — `…/Shared Documents/Forms/AllItems.aspx`, or a localized view name. Used as a path it narrows a `Path:` filter to nothing and can send a save into the library's `Forms` folder, while a `GetList` permission probe on it still passes, so nothing looks broken. Normalize it to the library root before you store or use it — on read as well as on write.
>
> **Ve zkratce.** U dokumentu v knihovně `ParentLink` z výsledku hledání často končí stránkou pohledu – `…/Shared Documents/Forms/AllItems.aspx`, případně s lokalizovaným názvem pohledu. Použitý jako cesta zúží filtr `Path:` na nic a umí poslat ukládání do systémové složky `Forms`, přičemž sonda oprávnění přes `GetList` na něm projde, takže nic nevypadá rozbitě. Než ho uložíš nebo použiješ, normalizuj ho na kořen knihovny – při čtení stejně jako při zápisu.

## Symptom

An app offers "recent places" built from search results. Picking one either narrows the next search to an empty result, or — worse — becomes the target folder of a save:

```
/sites/projects/Shared Documents/Forms/AllItems.aspx
```

The permission check for that target says "you may save here", so the first visible sign of trouble would be a file landing in `Forms`, the library's system folder.

## Cause

- For documents in a library, `ParentLink` frequently ends with a view page rather than the library or folder. The app cleaned it up for the **label** (dropping `.aspx` and `Forms`) but stored the raw `new URL(parentLink).pathname` as the **path** — label and path disagreed, and the path travelled on through local storage into search filters and saves.
- `GetList('<path>')` resolves any existing path inside a list to the list itself, `…/Forms/AllItems.aspx` included, so a list-level permission probe on the bad path answers for the library and passes. See the bonus section of [Get lists by URL, not by title](../rest-api/get-list-by-url-not-by-title.md).

## Fix

One normalizer for the label *and* the path, so they cannot drift apart:

```ts
/** "/sites/p/Shared Documents/Forms/AllItems.aspx" → "/sites/p/Shared Documents" */
function libraryRootPath(parentLink: string): string {
  const segs = decodeURIComponent(new URL(parentLink).pathname).split('/');
  if (/\.aspx$/i.test(segs[segs.length - 1])) segs.pop();                 // the view page
  if (segs[segs.length - 1].toLowerCase() === 'forms') segs.pop();        // the system folder
  return segs.join('/');
}
```

- **Normalize on read as well as on write.** Bad values already sit in users' browsers; fixing only the writer repairs the future, not the present.
- **Check the shape of a target path separately from permissions.** "You may save here" does not mean the path is the library root.

## Notes

- Nothing in the build catches this — the value is runtime data — and a fresh tenant with no click history will not reproduce it. Test with real search results and a real history of places.
- Related: [Compare SharePoint paths decode-first](compare-sharepoint-paths-decode-first.md).
