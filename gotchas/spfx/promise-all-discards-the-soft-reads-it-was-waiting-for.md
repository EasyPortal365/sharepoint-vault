---
title: "`Promise.all` discards the soft reads it was waiting for — one failing main read leaves every picker loading forever"
short-title: "`Promise.all` discards the soft reads it was waiting for"
summary: A failing main read rejects the batch and the soft reads' results and failure flags never reach the pickers; settle each read on its own
tags: [spfx, react, rest-api, loading-states, error-handling]
applies-to: SPFx web parts and extensions (any React UI that loads several lists at once)
last-reviewed: 2026-09-24
---

# `Promise.all` discards the soft reads it was waiting for — one failing main read leaves every picker loading forever

> **Bottom line.** When a strict main read and several soft reads (each with its own `catch`) share one `Promise.all`, a failure of the main read rejects the whole batch and the `.then` that would have stored the soft results never runs. Their data *and* their own failure flags are lost, so pickers fed by them stay "Loading…" forever or claim "nothing matches". Settle the secondary reads on their own chain, or turn the main read into a result object so the batch can never reject.
>
> **Ve zkratce.** Když striktní hlavní čtení a několik měkkých čtení (každé s vlastním `catch`) sdílí jeden `Promise.all`, pád hlavního čtení odmítne celou dávku a `.then`, který měl měkké výsledky uložit, se nespustí. Ztratí se jejich data *i* jejich vlastní příznaky selhání, takže výběry, které z nich žijí, „načítají“ navždy nebo tvrdí „nic neodpovídá“. Vedlejší čtení vyhodnoť vlastním řetězem, nebo hlavní čtení převeď na výsledek, aby dávka nikdy neodmítla.

## Symptom

A list screen loads its main data (tasks, contracts, subscriptions…) together with the lookup lists that its "New …" panel needs (contacts, companies, products). The main read fails — the screen shows its error message, as it should. But the "New …" button lives in the header and stays usable above the error, and the panel it opens is broken in one of two ways:

- a picker says **"Loading companies…"** and never stops;
- a picker says **"No contact matches"** although the list has hundreds of contacts — and invites the user to create a new one, i.e. a duplicate.

The lookup reads themselves finished: some succeeded, some failed with their own flag. Nothing reached the UI.

## Cause

`Promise.all` is fail-fast. The first rejected promise rejects the whole batch, and the `.then` that was going to hand out the results never runs:

```ts
Promise.all([
  svc.getTasks(),                              // strict: throws on failure
  softRead(contactSvc.getContacts()),          // soft: resolves { ok, items }
  softRead(companySvc.getCompanies())
]).then(([tasks, contacts, companies]) => {
  setItems(tasks);
  setContacts(contacts.items);  setContactsFailed(!contacts.ok);   // never runs if getTasks() threw
  setCompanies(companies.items); setCompaniesFailed(!companies.ok);
}).catch(e => setError(e.message));
```

The soft reads did their job — they resolved with `{ ok, items }` — but nobody stored the result. The picker state stays at its initial value: `loading: true` (spinner forever) or `[]` with `failed: false` (a confident "nothing here"). Making the secondary reads "soft" protected nothing, because their fate was decided by the main read.

A single shared `.catch` over independent reads has the same shape: one failing read silently cancels what the others were meant to do.

## Fix

Evaluate each read on its own. Either give the secondary reads their own chain:

```ts
softRead(companySvc.getCompanies()).then(r => {
  setCompanies(r.items);
  setCompaniesState({ loading: false, failed: !r.ok });
});
svc.getContracts()
  .then(list => { setItems(list); setLoading(false); })
  .catch(e => { setError(e.message); setLoading(false); });
```

…or turn the strict read into a result, so the batch can never reject, and take the parts apart one by one:

```ts
const mainRead = svc.getTasks().then(
  items => ({ ok: true as const, items }),
  error => ({ ok: false as const, error })
);
Promise.all([mainRead, softRead(contactSvc.getContacts())]).then(([main, contacts]) => {
  setContacts(contacts.items);
  setContactsFailed(!contacts.ok);          // always stored
  if (!main.ok) { setError(main.error.message); return; }
  setItems(main.items);
});
```

## Notes

- Give every read its own three states — *loading → failed → empty/data* — and set the flag in the branch where that read's result is produced, not in someone else's. A picker should say "Loading…", "Could not load — that does not mean there is nothing", or show the real list; only the last state may offer "create new".
- The tell-tale sign in review: one `Promise.all` mixing reads of different importance — strict ones whose failure is the screen's failure, and optional ones whose failure deserves only a note.
- `Promise.allSettled` does the same job where your target supports it; the result-object pattern above works in any ES2015 bundle.
- **The mirror image creates duplicates.** An edit panel loaded the record being edited together with a strict side read that only fed a counter ("12 documents in this group"). The side read failed and threw, `Promise.all` discarded the record that *had* loaded, and the panel decided `isEdit = existing !== null` → false. It switched to "New group", and Save created a second group. Decide edit mode from **intent** — the id the panel was opened with — not from whether the record arrived: `const initialIsEdit = typeof groupId === 'number'`, and while `initialIsEdit && !existing`, keep Save disabled and say why. Make a read that only feeds a counter soft, and show the count as `?` when it fails, not 0.
- Related: [An unparseable JSON column is not an empty column](unparseable-json-column-is-not-an-empty-column.md) — the write-side cousin, where a batch that "finished" unlocked saving over data that never arrived.
