---
title: Search ignores unknown managed properties — silently
tags: [search, kql, managed-properties, rest-api, diagnostics]
applies-to: SharePoint Online (Search REST /_api/search/query, KQL)
last-reviewed: 2026-07-25
---

# Search ignores unknown managed properties — silently

> **Bottom line.** A misspelled or non-existent managed property does not raise an error: `selectproperties` hands it back as a cell with `ValueType: Null`, and in `querytext` it matches nothing and returns `TotalRows: 0`. HTTP 200 proves nothing, and neither does the cell being present. The one probe that does tell the truth is **`sortlist`**, which is resolved against the schema and answers differently for "no such property" than for "exists but not sortable".
>
> **Ve zkratce.** Překlep nebo neexistující managed property nevyvolá chybu: `selectproperties` ji vrátí jako buňku s `ValueType: Null` a v `querytext` nic nenajde a vrátí `TotalRows: 0`. HTTP 200 nedokazuje nic – a přítomnost buňky taky ne. Jediná sonda, která říká pravdu, je **`sortlist`**: řeší se proti schématu a na „taková property neexistuje" odpovídá jinak než na „existuje, ale nejde podle ní řadit".

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

1. **`selectproperties` echoes back whatever you asked for.** The name you invented is not dropped from the projection — it comes back as a perfectly ordinary cell whose `ValueType` is `Null`. Measured on a live tenant:

   ```text
   selectproperties='Path,RefinableString00,ZzFakeProp123,ViewableByExternalUsers'

   Path                     ValueType=Edm.String    Value='https://…/Report.docx'
   RefinableString00        ValueType=Null          Value=''      ← real, never mapped
   ZzFakeProp123            ValueType=Null          Value=''      ← does not exist
   ViewableByExternalUsers  ValueType=Edm.Boolean   Value='false'
   ```

   Note rows 2 and 3: a **real but unmapped** property and a **fabricated** one are byte-for-byte identical in the response. Testing for the key's presence — or even for its `ValueType` — cannot separate them.
2. **Auto-created managed properties are not queryable.** When a new column is crawled, SharePoint creates a crawled property and an automatic managed property (`ows_<Name>`, or a typed variant like `<Name>OWSCHCS` for Choice). These are, by default, **retrievable at best — not queryable, not refinable, not sortable.** A KQL predicate against them therefore matches nothing rather than failing.

So both the "does it exist" check and the "does it have data" check return the same friendly HTTP 200 no matter what — and a feature built on top ships broken, reporting zeroes that look like a clean tenant.

## Fix

**Ask `sortlist`, not `selectproperties`.** Sorting is resolved against the search schema, so the service has to admit whether the name exists — and it distinguishes three cases with three different answers:

```text
sortlist='ViewableByExternalUsers:descending'  → HTTP 200                      exists, sortable
sortlist='ContentTypeId:descending'            → "An unknown error occurred."   exists, NOT sortable
sortlist='ZzFakeProp123:descending'            → "We didn't understand your     does not exist
                                                  search terms. Make sure
                                                  they're using proper syntax."
```

All three verified on a live tenant. The wording is the signal: *"didn't understand your search terms"* means the schema has never heard of the name, while any other error means it resolved and sorting was refused for some other reason.

```powershell
# Exists? One request, and the answer is unambiguous.
try {
    Invoke-PnPSPRestMethod -Method Get -Url "/_api/search/query?querytext='IsDocument:1'&sortlist='$prop`:descending'&rowlimit=1"
    'exists (sortable)'
}
catch {
    if ($_.Exception.Message -like "*didn't understand your search terms*") { 'DOES NOT EXIST' }
    else { 'exists, but not sortable' }
}
```

Still run a control name through the same probe — if your fabricated name is *not* rejected, the method does not hold on that tenant and no verdict should be reported. Ready-made: [`Test-SearchManagedProperty.ps1`](../../scripts/search/Test-SearchManagedProperty.ps1).

**The older control-probe comparison** still works for the narrower question "is it queryable?". Never conclude "the property works" from a successful call alone. Run the same query twice — once with your property, once with a name you invented — and compare:

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
3. Edit one of the pre-built `RefinableString`NN managed properties → **Add a Mapping** → pick the crawled property. (Microsoft documents the pool as `RefinableString00`–`RefinableString99`; check what your tenant actually offers in the schema list rather than trusting a number.)
4. Trigger a reindex of the site/library (Site settings → Search and offline availability → Reindex site) and wait for the crawl.
5. Query `RefinableString07:Internal` instead of the auto-generated name.

## Notes

- **This is a product decision you have to design around, not a bug to work around.** Requiring every customer to hand-map a schema entry is a real deployment cost — if your feature must work out of the box, get the data from the list REST API per site/library instead, and accept that it doesn't scale to a whole tenant in one query.
- The mapping is **tenant-wide** and the pool of `Refinable*` slots is finite (strings, plus dates, integers and decimals in their own smaller pools). Treat them as a shared resource and write down which slot you took; a second product silently reusing your slot produces mixed results.
- `RefinableString00:anything` returning 0 is *not* proof of anything either — an unmapped refinable exists but is empty. The `sortlist` probe tells these apart: it answers HTTP 200 for the unmapped refinable (it exists) and rejects the fabricated name.
- Wrapper libraries can hide the distinction entirely. PnP's `Submit-PnPSearchQuery` materialises every requested property as a key on each result row, so a "does the key come back?" test passes for *every* name including invented ones. Go to `/_api/search/query` directly when the answer matters.
- The failure mode is worst for **counting** features ("how much content is classified?"), because zero is a plausible answer. Whenever a number could legitimately be zero, prove your query works on data you know exists before trusting the zero.
