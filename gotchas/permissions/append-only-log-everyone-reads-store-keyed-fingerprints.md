---
title: An append-only log that several roles must read can't be split by ReadSecurity – store keyed fingerprints instead of snapshots
short-title: Append-only log read by many – keyed fingerprints
summary: "Read-all-but-edit-nothing for one role and own-rows-only for another can't coexist on one list; keep ReadSecurity 1 and put only keyed SHA-256 fingerprints of sensitive values in the rows"
tags: [permissions, item-level, readsecurity, append-only, security, hashing]
applies-to: SharePoint Online
last-reviewed: 2026-11-19
---

# An append-only log that several roles must read can't be split by ReadSecurity – store keyed fingerprints instead of snapshots

> **Bottom line.** A typical audit log of approvals: approvers add rows, accounting must read *all* rows (queue, approval state, next batch number) but change nothing. You can't set "accounting reads everything, approvers read only their own" on one list: item-level read (`ReadSecurity = 2`) is bypassed only by a level that can also edit or manage the list. So keep the list at `ReadSecurity = 1` and change *what the row contains*: no readable snapshot of sensitive values, and no plain hash either – a SHA-256 of each value **keyed with a secret of the parent record** that only its readers can see.
>
> **Ve zkratce.** Append-only stopa schválení, kterou musí jedna role číst celou a nic v ní neměnit, zatímco jiná má vidět jen své řádky, se na jednom seznamu nastavit nedá: item-level čtení obchází jen úroveň, která zároveň upravuje nebo spravuje seznam. Nech seznam s `ReadSecurity = 1` a změň obsah řádku – místo čitelného snímku citlivých hodnot jen otisk SHA-256 s klíčem nadřazeného záznamu (ne prostý hash).

## Symptom

An approval log stores a snapshot of the approved record (company ID, bank account, variable symbol, amount) so a later check can tell "approved, then changed". Every approver can read every row – including snapshots of records they were never allowed to open.

The obvious fix – `ReadSecurity = 2` plus "accounting and admins read everything" – breaks two things:

- Accounting only has *add* rights on the log (append-only). With `ReadSecurity = 2` they now see only their own rows: the approval queue, approval state and anything numbered from the rows (export batch numbers, protocol numbers) silently lose colleagues' rows, and a second accountant gets a batch number that is already taken.
- Giving accounting a level that bypasses item-level read (Edit, or a custom level with *Manage Lists*) also gives them edit/delete on rows – they could rewrite an approval and its snapshot, which is the forgery the log is meant to catch.

## Cause

Item-level read on a list is bypassed by *Manage Lists* (measured) and, according to its description, *Override List Behaviors* (not measured) – see [A count over a ReadSecurity 2 list is the reader's share](a-count-over-a-readsecurity-2-list-is-the-readers-share.md). The built-in levels that carry them also carry item editing, and *Manage Lists* in a custom "add only" level would let the user turn off versioning or delete the list. "Reads every row, changes none" and "reads only own rows" therefore can't be configured on the same list with the built-in levels; a custom "Add + Override List Behaviors" level is untested – measure it with `getusereffectivepermissions` under a non-admin account before relying on it.

## Fix

1. **Keep `ReadSecurity = 1`** on an append-only list that some role must read in full. Protect the content by what goes into the row, not by who sees the row.
2. **No readable snapshot, no plain hash.** Company IDs (about 10⁸ values), variable symbols, amounts and dates are low-entropy – a plain SHA-256 is brute-forced in the browser in seconds. Store `SHA-256(recordKey + fieldName + value)` per field, where `recordKey` is something only readers of the parent record can see (its `GUID` works – an approver without access to the record doesn't get it). Per-field fingerprints still let you say *which* field changed after approval.
3. **Free-text columns of the row** (Title etc.) shouldn't identify the foreign record either – use the parent item Id, not a document number or supplier name.
4. **Take a role off a list it doesn't need at all** (remove its group from the list) instead of `ReadSecurity = 2` – stricter, and other roles keep full read. If something is numbered from the rows, add a test that the numbering role sees the whole list.
5. **Old rows stay valid.** Version the row format (e.g. `{"v":2,...}`), keep verifying old snapshot rows, write only fingerprints from now on – nothing is rewritten or deleted.

## Notes

- If the computation that checks the fingerprints runs synchronously (pure functions that build approval state), a small synchronous SHA-256 implementation is fine; test it against Node's `crypto`.
- Related: [Item-level edit rights cover every field](item-level-edit-rights-cover-every-field.md) – why approval itself must be checked against version history.
