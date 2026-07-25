---
title: Search ignores unknown managed properties — silently
tags: [search, kql, managed-properties, rest-api, diagnostics]
applies-to: SharePoint Online (Search REST /_api/search/query, KQL)
last-reviewed: 2026-07-25
---

# Search ignores unknown managed properties — silently

> **Bottom line.** A misspelled or non-existent managed property does not raise an error: in `selectproperties` it is dropped and the query returns full results, and in `querytext` it matches nothing and returns `TotalRows: 0`. HTTP 200 therefore proves nothing about whether the property exists. Before you build on a custom property, run a **control probe with a deliberately fake name** — if the fake behaves the same as yours, your property isn't working either.
>
> **Ve zkratce.** Překlep nebo neexistující managed property nevyvolá chybu: v `selectproperties` se zahodí a dotaz vrátí plné výsledky, v `querytext` nic nenajde a vrátí `TotalRows: 0`. HTTP 200 tedy o existenci property neříká vůbec nic. Než na vlastní property něco postavíš, pusť **kontrolní dotaz se schválně vymyšleným jménem** – když se vymyšlená chová stejně jako tvoje, nefunguje ani tvoje.

## Symptom

You add a site/list column (say `EP365Classification`, a Choice field), wait for the crawl, and check whether Search can see it:

```
/_api/search/query?querytext='IsDocument:1'&selectproperties='EP365ClassificationOWSCHCS'&rowlimit=1
→ HTTP 200, TotalRows: 93        ✅ "great, the property exists"
```

It doesn't. The exact same query with a name you invented on the spot returns the same thing:

```
/_api/search/query?querytext='IsDocument:1'&selectproperties='EP365NeexistujeXyz123'&rowlimit=1
→ HTTP 200, TotalRows: 93        ❌ the fake property is just as "successful"
```

And filtering behaves the same way — no error, just nothing:

```
querytext='EP365ClassificationOWSCHCS:Internal'  → TotalRows: 0
querytext='EP365NeexistujeXyz123:whatever'       → TotalRows: 0
querytext='ContentTypeOWSCHCS:Document'          → TotalRows: 0   ← real data, still nothing
querytext='ContentType:Document'                 → TotalRows: 147 ← built-in property works
```

The last two lines are the giveaway: an **auto-generated** managed property (`…OWSCHCS`, `ows_*`) is not usable in KQL even when the underlying data definitely exists.

## Cause

Two separate behaviours combine into a very convincing lie:

1. **`selectproperties` is best-effort.** Names the schema doesn't know are dropped from the projection; the query itself still runs and returns rows. There is no "unknown property" error to notice.
2. **Auto-created managed properties are not queryable.** When a new column is crawled, SharePoint creates a crawled property and an automatic managed property (`ows_<Name>`, or a typed variant like `<Name>OWSCHCS` for Choice). These are, by default, **retrievable at best — not queryable, not refinable, not sortable.** A KQL predicate against them therefore matches nothing rather than failing.

So both the "does it exist" check and the "does it have data" check return the same friendly HTTP 200 no matter what — and a feature built on top ships broken, reporting zeroes that look like a clean tenant.

## Fix

**Diagnose with a control probe.** Never conclude "the property works" from a successful call alone. Run the same query twice — once with your property, once with a name you invented — and compare:

```ts
const probe = async (prop: string): Promise<number> => {
  const r = await fetch(
    `${web}/_api/search/query?querytext='${prop}:*'&rowlimit=1`,
    { headers: { Accept: 'application/json;odata=nometadata', 'odata-version': '3.0' } }
  );
  const d = await r.json();
  return d.PrimaryQueryResult?.RelevantResults?.TotalRows ?? -1;
};

const mine = await probe('EP365ClassificationOWSCHCS');
const fake = await probe('EP365DefinitelyNotAProperty123');
// mine === fake  →  your property is NOT queryable (regardless of HTTP status)
```

**Make it actually queryable.** Map the crawled property to one of the pre-built refinable managed properties, which *are* queryable/refinable/sortable:

1. SharePoint admin center → **More features → Search → Manage Search Schema**.
2. Find `ows_<YourColumn>` under Crawled Properties (it appears only after the first crawl that saw the column).
3. Edit a `RefinableString00`–`RefinableString49` managed property → **Add a Mapping** → pick the crawled property.
4. Trigger a reindex of the site/library (Site settings → Search and offline availability → Reindex site) and wait for the crawl.
5. Query `RefinableString07:Internal` instead of the auto-generated name.

## Notes

- **This is a product decision you have to design around, not a bug to work around.** Requiring every customer to hand-map a schema entry is a real deployment cost — if your feature must work out of the box, get the data from the list REST API per site/library instead, and accept that it doesn't scale to a whole tenant in one query.
- The mapping is **tenant-wide** and the pool of `Refinable*` slots is finite (50 strings, plus dates/numbers). Treat them as a shared resource and write down which slot you took; a second product silently reusing your slot produces mixed results.
- `RefinableString00:anything` returning 0 is *not* proof of anything either — an unmapped refinable exists but is empty. Same control-probe rule applies.
- The failure mode is worst for **counting** features ("how much content is classified?"), because zero is a plausible answer. Whenever a number could legitimately be zero, prove your query works on data you know exists before trusting the zero.
