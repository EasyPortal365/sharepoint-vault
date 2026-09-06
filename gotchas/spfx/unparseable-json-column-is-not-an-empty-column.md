---
title: An unparseable JSON column is not an empty column — read-merge-write wipes the record
tags: [spfx, lists, rest-api, json, data-loss, fail-closed]
applies-to: SharePoint Online (any app that stores JSON in a list column)
last-reviewed: 2026-09-06
---

# An unparseable JSON column is not an empty column — read-merge-write wipes the record

> **Bottom line.** `try { JSON.parse(col) } catch { {} }` turns "could not read" into "is empty", and the next save of that record writes the emptiness back — a corrupt theme, vote, thread or targeting column silently becomes a blank one. Carry an `unreadable` flag from the read, refuse to write over it before the first PATCH, lock the form with a visible notice, and make recovery an explicit action.
>
> **Ve zkratce.** `try { JSON.parse(col) } catch { {} }` udělá z „nepřečteno" „prázdné" a další uložení záznamu to prázdno zapíše zpět – poškozený motiv, hlas, vlákno nebo cílení se tiše promění v prázdný sloupec. Čtení ať nese příznak `unreadable`, zápis nad ním odmítni ještě před prvním PATCH, formulář zamkni s viditelnou hláškou a obnovu udělej výslovnou akcí.

## Symptom

A record in a SharePoint list keeps some of its state as JSON in a text column (a config blob, a per-user vote, a conversation thread, an audience/targeting rule, a saved filter). Someone edits the record in the app. Afterwards the JSON column is empty — or holds a default — and nobody changed that field on purpose.

The trigger is a column the app could not parse: a hand edit in the list UI, a truncated value, an older schema, a column the query silently left out. The app's reader looked like this:

```ts
let cfg: IConfig = {};
try { cfg = JSON.parse(row.ConfigJson); } catch (e) { cfg = {}; }
return { config: cfg, loaded: true };
```

Every consumer downstream now works with `{}` as if it were the truth. A form renders empty fields, the user changes one thing and saves, and the save is a merge of the form state — so the whole column is rewritten with the empty object plus the one edit.

The same shape hides in several places that do not look like "config":

| Where the JSON lives | What the silent `{}` / `[]` did |
|---|---|
| Site theme / brand identity blob | a full-field save overwrote the theme for every site that inherits it |
| Per-user poll vote | the vote read as "not voted" → a second row was created and counted twice |
| Message thread on an inquiry | the thread read as `[]` → "append a message" wrote a thread with one message |
| Targeting / audience rule on a document | the rule read as "no targeting" → the document became visible to everyone |
| Saved filter of a segment | "rename" patched an empty filter — the filter *was* the segment |
| Seed marker for a lookup list | a corrupt marker read as "not seeded" → the seed ran again and duplicated the choices |

## Why this happens

One `catch` collapses two different facts — *not readable* and *empty* — into a single value, and the value has the right type. The compiler is happy, the UI is happy, and the write path has no way to tell the difference. Anything derived from the value (visibility, counts, defaults, "already done" markers) inherits the lie.

The write is what makes it destructive. A read that returns `{}` is only a wrong screen; a read-merge-write over `{}` is data loss, and it is committed by a user who clicked "Save" on a form that looked fine.

## Fix pattern

Keep **three states** apart, and never let the third one reach a write:

1. **No row** — the default applies; a save may create the row.
2. **Row with valid JSON** — normal read; a save may merge.
3. **Row with unparseable JSON** — `unreadable: true` (per record or per field) plus the row Id in `console.error`; a save **throws before the first request**, the form shows a notice naming the record and the field, and the Save button is disabled. Recovery is a deliberate button ("Replace with the values from this form", "Discard my corrupt vote"), never the default path.

```ts
interface IConfigRead { config: IConfig; loaded: boolean; corrupt?: { id: number; error: string } }

function readConfig(row: IRow | undefined): IConfigRead {
  if (!row) return { config: {}, loaded: true };                 // state 1
  try {
    return { config: JSON.parse(row.ConfigJson || '{}'), loaded: true }; // state 2
  } catch (e) {
    console.error('[config] row ' + row.Id + ' has unparseable JSON', e);
    return { config: {}, loaded: false, corrupt: { id: row.Id, error: String(e) } }; // state 3
  }
}

async function saveConfig(read: IConfigRead, patch: Partial<IConfig>): Promise<void> {
  if (!read.loaded || read.corrupt) {
    throw new Error('The stored configuration could not be read (row ' + (read.corrupt ? read.corrupt.id : '?') + '); saving is disabled so it is not overwritten.');
  }
  // …merge + PATCH…
}
```

Derived facts must fail closed as well: an unreadable targeting rule means *targeted* (nobody sees it), an unreadable policy counts as "not read" rather than "none", and an unreadable seed marker means "do not seed".

## Neighbours of the same bug

They do not contain a `catch`, but they produce the same "empty that is really unread":

- **`Promise.all` over several reads** — when one read rejects, the others are lost too; if the code unlocks writing after the batch "finished", it unlocks over nothing. Settle each read on its own and only set what actually arrived.
- **Progressive `$select` fallback** — after an HTTP 400 on a column that is still being provisioned, the code retries without it; the record then arrives *without* the field, and a later save writes the field as empty. The fallback must record which fields were left out.
- **A pinned-version row the loader cannot parse** — treated as "no pin" it silently loads the latest build; treat it as "unknown" and stay on the last known version instead.
- **A message that says "saving is disabled"** next to a button that still works — the text was written for one failure mode and the lock for none. Check that the notice and the disabled state come from the same flag.

## Guard it in the build

A unit test that imports the real service, feeds it a fake client returning valid / corrupt / missing rows, and **counts the write calls** catches every regression of this class: valid → one merge; corrupt → zero writes and a thrown error; missing → one create. Put it on the command that produces the release, not on a test runner nobody invokes, and prove the guard bites by temporarily removing the gate: the test must fail, then restore it.

## Related

- [A test outside the release command guards nothing](a-test-outside-the-release-command-guards-nothing.md)
- [Office file extraction needs a decompressed-size cap](office-file-extraction-needs-a-decompressed-size-cap.md) — the other place where "check after the damage" looked like a check
