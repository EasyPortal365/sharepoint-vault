---
title: "A deleted site and a site you cannot see are two different answers — read the status, not `ok`"
tags: [rest-api, cross-site, error-handling, permissions, governance, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-28
---

# A deleted site and a site you cannot see are two different answers

> **Bottom line.** Any inventory that points at *other* sites — a site map, a link directory, a library catalogue — eventually holds rows whose target is gone. If you read `<site>/_api/web` as `if (!r.ok) return unknown`, a dead row looks exactly like a site you merely lack permission on. Those two need opposite handling: one is a defect in **your list** that somebody must fix, the other is a fact about **someone else's site** that you should not comment on. `_api/web` on a site collection that does not exist answers **404**; keep `r.status` and you can tell them apart.
>
> **Ve zkratce.** Každý registr cizích webů (mapa webů, rozcestník, katalog knihoven) dřív nebo později obsahuje řádek, jehož cíl už neexistuje. Když čteš `<web>/_api/web` jako `if (!r.ok) return unknown`, vypadá mrtvý řádek stejně jako web, na který jen nemáš práva — a přitom si žádají opačné zacházení: první je vada TVOJÍ evidence, druhé je fakt o cizím webu, ke kterému se nemáš co vyjadřovat. Neexistující site collection vrací na `_api/web` **404**; nech si `r.status` a rozlišíš je.

## Symptom

A governance view lists sites with an owner and a responsible person. Rows the app cannot read are shown as *unknown* — deliberately, because claiming "no owner" about a site you cannot see is worse than saying nothing.

Then someone notices six rows that will never resolve: their addresses were typos, or the sites were deleted years ago. The view keeps reporting them as *unknown*, which reads as "probably fine, we just cannot look inside". Nobody cleans them up, because nothing says they are broken.

## Cause

The read collapses every failure into one state:

```ts
const r = await this.sp.get(`${abs}/_api/web?$select=...`, cfg, { headers: { Accept: 'application/json' } });
if (!r.ok) return { unknown: true, /* … */ };   // 404? 403? 500? — indistinguishable
```

## What SharePoint Online actually answers

Measured from a signed-in browser session, same origin, `Accept: application/json`:

| Request | Result |
|---|---|
| `/sites/<does-not-exist>/_api/web` | **404** — no redirect, `fetch` resolves normally |
| `/sites/<exists, user has access>/_api/web` | 200 |

So a 404 is usable as *"SharePoint found nothing at this address"*. The complementary case — a site that exists while the caller has no permission — is documented to answer **403** with an access-denied payload; if your solution leans on that branch, measure it in your own tenant before you ship wording that depends on it.

## Fix

Keep the status and model **three** states instead of two:

```ts
export interface ISiteMeta {
  unknown: boolean;   // we could not determine anything
  gone: boolean;      // 404 — nothing answers at this address
  // …
}

const r = await this.sp.get(`${abs}/_api/web?$select=...`, cfg, { headers: { Accept: 'application/json' } });
if (!r.ok) return { ...empty, gone: r.status === 404 };
```

Then let the UI act on the difference:

* **404 → a defect in your own list.** Mark it as such (its own badge, tile and filter) and say what to do about it: fix the address, or delete the row. A broken pointer is never fixed by a label alone.
* **anything else → say nothing about the site.** Keep it *unknown*, and keep it out of counts like "sites without an owner" — a number people negotiate with must not include rows you never managed to read.

## Word it in layers

State the **fact** first and the **interpretation** second:

> **The address leads nowhere.** SharePoint found no site here — it was most likely deleted or renamed.

The first sentence is what you measured and stays true no matter how the tenant behaves; the second is the likely explanation, and is marked as such. If some configuration ever returned 404 for a site that exists but is hidden from the caller, the claim still holds. Wording that asserts "this site was deleted" would not.

## See also

* [\"File is missing\" vs. \"I cannot read it\"](missing-file-404-vs-cannot-read.md) — the same distinction one level down, for files
* [`fields/getbyinternalnameortitle` 400s for a missing field](getbyinternalnameortitle-400-not-404.md) — not every "missing" answers 404
