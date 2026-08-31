---
title: A new Choice value in your provisioning code never reaches already-deployed sites
tags: [rest-api, fields, provisioning]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-09-01
---

# A new Choice value in your provisioning code never reaches already-deployed sites

> **Bottom line.** Idempotent "create the field if it's missing" provisioning never *updates* a field that already exists — so a new Choice value (or any schema change) you add to the manifest silently no-ops on every site that already had the field. Reconcile existing fields with a targeted post-provisioning PATCH, sent `odata=verbose` with `SP.FieldChoice`.
>
> **Ve zkratce.** Idempotentní provisioning „vytvoř pole, když chybí" už existující pole nikdy neaktualizuje – nová hodnota Choice (nebo jakákoli změna schématu) přidaná do manifestu se na webech, kde pole už bylo, tiše přeskočí. Existující pole dorovnej cíleným post-provisioning PATCHem ve formátu `odata=verbose` s typem `SP.FieldChoice`.

## Symptom

You extend a Choice field's allowed values in your declarative provisioning — you add `Scheduled` to a `DocStatus` field — bump the schema version, and redeploy.

- **Brand-new sites are fine:** the field is created from the manifest, `Scheduled` included.
- **Sites that already had the field are broken:** the new value simply isn't there. Your app's forms and pickers don't offer it, dashboards can't group by it, and writing the new value fails with **HTTP 400** — the value isn't among the field's choices.

The manifest clearly lists the value; the deployed field disagrees. It looks like a deployment or seeding bug, but the code and the manifest are both correct.

## Cause

Provisioning frameworks make field creation idempotent with an **existence check**:

```http
GET /_api/web/lists/getbytitle('Documents')/fields/getbyinternalnameortitle('DocStatus')
```

If the field exists, the `POST /fields` is **skipped**. That skip is *correct* — re-POSTing an existing field creates a duplicate with an auto-suffixed InternalName (`DocStatus0`, `DocStatus1`). But the consequence is that the manifest is applied only at **first create**. Any later change to an *existing* field's definition — new `Choices`, a type change, a formula, a `Required` toggle — is never reconciled.

Bumping a "schema version" gate doesn't help either: it re-runs provisioning, but provisioning still won't touch a field that already exists.

## Fix

Add a targeted **post-provisioning migration** that reconciles just the field you changed. Read the current choices, and if the new value is missing, PATCH the field. The PATCH must be verbose because it carries `__metadata`:

```ts
// 1) read current choices
//    nometadata -> Choices is a plain array; verbose -> { results: [...] }. Handle both.
const url = `${web}/_api/web/lists/getbytitle('Documents')/fields/getbyinternalnameortitle('DocStatus')`;
const res = await sp.get(`${url}?$select=Choices`, cfg, { headers: { Accept: 'application/json;odata=nometadata' } });
if (!res.ok) return;                                             // MUST NOT continue: see "widen only" below
const raw = (await res.json()).Choices;
const current: string[] = Array.isArray(raw) ? raw : (raw && raw.results) || [];
if (current.indexOf('Scheduled') !== -1) return;                 // already there — no-op

// 2) send the FULL canonical list back as a MERGE (Choices is replace, not append)
const desired = ['Draft', 'PendingApproval', 'Scheduled', 'Published', 'Archived'];
current.forEach(c => { if (desired.indexOf(c) === -1) desired.push(c); }); // keep unknown legacy values
await sp.post(url, cfg, {
  headers: {
    Accept: 'application/json;odata=verbose',
    'Content-Type': 'application/json;odata=verbose',
    'X-HTTP-Method': 'MERGE',
    'IF-MATCH': '*'
  },
  body: JSON.stringify({ __metadata: { type: 'SP.FieldChoice' }, Choices: { results: desired } })
});
```

Key points:

- **`Choices` is replace, not append** — send the complete, canonically ordered list, and preserve any unknown existing values by appending them at the end.
- **Make it idempotent** — bail out when the value is already present, so it costs a single GET on every subsequent load.
- **Make it fail-safe** — a normal user without `ManageLists` can't PATCH a field definition. Catch and warn; never let it abort provisioning. The first admin who opens the app reconciles the field for everyone.
- **Run it *after* your normal provisioning pass**, not instead of it.

## The reconcile widens, never narrows — and a failed read is not an empty vocabulary

Both halves of that sentence are load-bearing, and they fail together.

**Widen only.** `Choices` replaces the whole set, so the reconcile is a *union* of the manifest and what the field already holds. It is tempting to make it an assignment instead — "the manifest is the truth, write exactly that" — and on a fresh site it behaves identically. On a deployed site it is destructive in a way SharePoint will not warn you about: **items already carry the values you are removing.** Nothing is deleted from the items; the stored value simply stops being part of the field's vocabulary. The result is a column whose contents are no longer valid according to its own definition:

- forms show the item's current value as out of range and refuse to save an unrelated edit to that item;
- group-by and filters offer a set that does not cover the data;
- a `$filter` on the retired value still matches rows that the picker can no longer produce.

If a value must go out of use, retire it in the UI (stop offering it, migrate the items, then remove it) — not by shrinking the definition underneath live data.

**A failed read collapses the union into the manifest.** That makes the strict read above more than hygiene. Reading the current `Choices` fails for perfectly ordinary reasons — a member without `ManageLists` gets `403`, a busy tenant returns `429`, and a missing field answers with HTTP **400**, not 404 ([`fields/getbyinternalnameortitle` 400s for a missing field](getbyinternalnameortitle-400-not-404.md)). A helper that resolves any of those to `[]` produces an empty "current" set, and:

```
desired = manifest ∪ current   →   manifest ∪ ∅   →   manifest
```

The MERGE then goes through with full authority and **deletes every value the manifest does not know about** — including the ones an older release added and the ones a customer added by hand. The call returns `204`, the log says "reconciled", and the damage is only visible in the field's definition.

So: check `res.ok` (and the parsed shape) before computing the union, and treat "could not read the current choices" as a reason to do nothing this run. An unknown current state is never a licence to write an authoritative one.

## Notes

- The same pattern fixes any existing-field schema drift: a `Required` toggle, a new calculated formula, an added lookup — the create-if-missing step won't apply them, a post-hook MERGE will.
- The MERGE `type` must match the field — `SP.FieldChoice` (or `SP.FieldMultiChoice`), `SP.FieldText`, `SP.FieldNumber`, and so on. The wrong `type` 400s. (`__metadata` also requires `odata=verbose` on both headers — see [`__metadata` body requires verbose](metadata-body-requires-verbose.md).)
- Related trap, opposite direction: [Choice fields accept any value over REST](choice-fields-accept-any-value.md). The two compound — even where a raw write would otherwise slip an unknown value through, the field on already-deployed sites still lacks it in its *definition*, so forms won't offer it and group-bys ignore it. Keep the field definition and your app's vocabulary in lockstep.
- Don't "fix" it by deleting and recreating the field — that destroys every value already stored in the column. Reconcile in place.
