---
title: View formatting lands on the wrong view — and a missing column is not an empty string
tags: [lists, formatting, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-08-19
---

# View formatting lands on the wrong view — and a missing column is not an empty string

> **Bottom line.** Code that applies JSON formatting usually looks for `AllItems.aspx` and falls back to "whatever view is default". The Site Pages library has no `AllItems.aspx` (its all-items view is `AllPages.aspx`), and a site's default view may well be a grouped one like `ByAuthor.aspx` — so the card formatter gets written onto a view built for something else. Then, because a column that is **absent from the view** evaluates to `undefined` rather than `''`, the usual `=if([$Field] == '', 'none', …)` guard does not hide anything and the cards render blank.
>
> **Ve zkratce.** Kód, který aplikuje JSON formátování, obvykle hledá `AllItems.aspx` a jinak vezme „výchozí pohled". Knihovna Site Pages žádný `AllItems.aspx` nemá (jmenuje se `AllPages.aspx`) a výchozí pohled webu bývá i seskupený `ByAuthor.aspx` – formatter tak přistane na pohledu, pro který nebyl psaný. A protože sloupec **chybějící v pohledu** není prázdný řetězec, ale `undefined`, pojistka `=if([$Pole] == '', 'none', …)` nic neskryje a karty vyjdou prázdné.

## Symptom

A library you format from code looks broken: cards with no title, placeholder thumbnails, and a date that renders as a lone `1.` — while the same formatter works fine on your own lists.

## Cause

Two independent mistakes that meet in the middle.

**1. The view lookup is too forgiving.** A typical resolver:

```ts
// pick AllItems.aspx…
let pick = views.find(v => v.ServerRelativeUrl.toLowerCase().includes('/allitems.aspx'));
// …otherwise "the default view", whatever that is
if (!pick) pick = views.find(v => v.DefaultView);
```

For Site Pages the first branch never matches, and the second one happily hands you `ByAuthor.aspx`, `ByEditor.aspx` or `RecentChanges.aspx` — views that group by a field and carry a different column set.

**2. The columns were never really added.** Formatting code often adds view fields best-effort (`try { addviewfield } catch { /* ignore */ }`) and, on the "only add what's missing" path, forgets `Title` entirely. `addviewfield` on a column that does not exist on the list fails quietly, so nothing is added and nothing is reported.

The rendering consequence is the part people get wrong: for a column **not present in the view**, `[$Column]` is not an empty string. `=if([$Column] == '', 'none', 'inline-flex')` is therefore *false* and the element stays visible, empty. Date helpers degrade the same way — `getDate('')` yields `1` while `getMonth('')` and `getYear('')` produce nothing, which is where the stray `1.` comes from.

## Fix

**Only ever format an all-items view, and never a specialised one:**

```ts
const isAll = (v) => {
  const u = (v.ServerRelativeUrl || '').toLowerCase();
  return u.indexOf('/allitems.aspx') !== -1 || u.indexOf('/allpages.aspx') !== -1;
};
let pick = views.filter(v => !v.Hidden).find(v => isAll(v) && v.DefaultView)
        ?? views.filter(v => !v.Hidden).find(isAll);
if (!pick) return false;   // no all-items view → format nothing
```

**Read the columns back and fail closed:**

```ts
await addMissingViewFields(viewUrl, ['Title', ...fields]);
const after = (await readViewFields(viewUrl)).map(f => f.toLowerCase());
if (!['Title', ...fields].every(f => after.includes(f.toLowerCase()))) return false;  // skip the formatter
await mergeView(viewUrl, { ViewType2: tile ? 'TILES' : '', CustomFormatter: escaped });
```

A default table beats a broken card. And do not flip `DefaultView` on a library that SharePoint owns (Site Pages, Documents) — changing which view users land on is the site owner's call, not your provisioning code's.

## How to tell whether your code touched a view

`ViewType2` is `null` on views nobody has formatted and a string (`''` for List, `'TILES'` for Gallery) on views that were written to:

```
GET /_api/web/GetList('/sites/team/SitePages')/views?$select=Title,DefaultView,Hidden,ServerRelativeUrl,ViewType2
```

To undo it in the UI: open the view → **Format view** → clear the JSON box → **Save**.

## Related

- [An empty date is not an empty string in formatting](empty-date-is-not-an-empty-string-in-formatting.md)
- [Gallery cards render from `tileProps`](gallery-cards-render-from-tileprops.md)
- [View formatter rejects `<` and `&`](view-formatter-rejects-angle-bracket-and-ampersand.md)
