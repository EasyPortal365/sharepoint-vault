---
title: The user's own row found by a text column can be planted by anyone with Manage Lists — pick per-user rows by Author, and distrust rows someone else last edited
short-title: The user's own row by a text column can be planted
summary: On a per-user list with `ReadSecurity = 2` / `WriteSecurity = 2`, a lookup like `$filter=Title eq '<my e-mail>'&$top=1` returns whatever row has that text — and site owners, collection admins and Edit members (Manage Lists) can create one for you, with a lower Id; select `Author` and `Editor`, keep only rows the current user created, and never let automation run from a row someone else last edited
tags: [permissions, lists, item-level-security, identity, author, editor]
applies-to: SharePoint Online and Server — any per-user settings, memory, history or schedule stored as list items and looked up by the user's e-mail, login or id in a text column
last-reviewed: 2026-11-16
---

# The user's own row found by a text column can be planted by anyone with Manage Lists — pick per-user rows by Author, and distrust rows someone else last edited

> **Bottom line.** Item-level security (`ReadSecurity = 2`, `WriteSecurity = 2`) keeps ordinary contributors out of each other's rows, but anyone with **Manage Lists** — site owners, site collection admins, and on many team sites every member with the Edit level — reads and writes every row. If your code finds "my row" with `$filter=Title eq 'anna@contoso.com'` (or a `UserId` text column) and takes the first hit, such a person can create a row with Anna's e-mail and a lower `Id`, and Anna's browser will load *their* settings, prompt, memory or scheduled job. Select `Author/EMail,Author/Name` (and `Editor/…`), keep only rows whose **Author** is the signed-in user, and treat a row whose **Editor** is someone else as untrusted for anything that runs without a click.
>
> **Ve zkratce.** Oprávnění na úrovni položek (`ReadSecurity = 2`, `WriteSecurity = 2`) drží od cizích řádků běžné přispěvatele, ale kdo má **Spravovat seznamy** – vlastníci webu, správci kolekce a na řadě týmových webů i každý člen s úrovní Úpravy – čte a zapisuje všechny řádky. Když kód hledá „můj řádek“ přes `$filter=Title eq 'anna@contoso.com'` (nebo textový sloupec s id) a vezme první výsledek, může takový člověk založit řádek s Anniným e-mailem a nižším `Id` a Annin prohlížeč načte JEHO nastavení, prompt, paměť nebo naplánovanou úlohu. Načítej `Author/EMail,Author/Name` (a `Editor/…`), nech jen řádky, jejichž **Author** je přihlášený uživatel, a řádek, který naposledy upravil někdo jiný, ber jako nedůvěryhodný pro všechno, co běží bez kliknutí.

## Symptom

A per-user list — settings, saved prompts, assistant memory, conversation history, scheduled routines — looked private and passed every test with two ordinary accounts:

- Each user saw only their own rows (item-level read security works).
- Each user could not change another user's row (item-level write security works).

Then a site owner (or any member with Manage Lists) created an item with `Title = anna@contoso.com` through REST. Anna's next page load picked that item, because the lookup was "first row with my e-mail", and the planted item had the lower `Id`. Nothing failed and nothing in the UI showed that the row was not hers.

The same shape shows up in audit trails: a row "logged by" a text column `UserId` can be written by any member under a colleague's name.

## Cause

- Text columns are written by the client. `Title`, `UserId`, `Owner e-mail` are claims, not facts. Only `Author` (who created the item), `Editor` (who last changed it), `Created` and `Modified` are set by the server.
- Item-level security is bypassed by **Manage Lists** (`0x800`). The Edit level includes it — see [A count over a ReadSecurity 2 list is only the reader's share](a-count-over-a-readsecurity-2-list-is-the-readers-share.md).
- `$top=1` plus default ordering by `Id` makes the oldest matching row win — the attacker just needs to be first.

## Fix

Read the server fields with every per-user lookup and filter in code:

```ts
const sel = 'Id,Title,MyJson,Author/EMail,Author/Name,Editor/EMail,Editor/Name';
const url = `${web}/_api/web/GetList(@u)/items?@u='${lit}'`
  + `&$filter=Title eq '${odata(me.email)}'&$orderby=Id asc&$top=20`
  + `&$select=${sel}&$expand=Author,Editor`;

const tail = (v: unknown) => { const s = String(v || '').trim().toLowerCase(); return s.includes('|') ? s.slice(s.lastIndexOf('|') + 1) : s; };
const isMe = (p: { EMail?: string; Name?: string } | undefined) => {
  const mail = String(p?.EMail || '').toLowerCase(), upn = tail(p?.Name);
  const mine = [me.email.toLowerCase(), tail(me.loginName)].filter(Boolean);
  return !!(mail || upn) && (mine.includes(mail) || mine.includes(upn));
};

const rows = data.value.filter(r => isMe(r.Author));          // planted rows drop out
const row = rows[0];
const foreignEdit = !!row && !isMe(row.Editor);                // someone else changed my row
```

- Match on e-mail **or** the UPN from the login name, never on the display name.
- Log only the number of dropped rows, not their content.
- If `foreignEdit` is true, load the row for display but switch off anything automatic it drives (scheduled runs, messages to Teams channels, e-mails to stored recipients) until the user saves it again. A site owner can still *read* the row — say so in your privacy text instead of promising "only you can see it".
- For audit or evidence lists, show the person from `Author`, and highlight rows where the text column claims someone else.

## Notes

- `$expand=Author,Editor` works on lists with item-level security; the caller needs nothing beyond read access to the row.
- The text column is still useful as a fast, indexable filter — just never as the proof of ownership.
- Admin-side variant (approver executes what a member wrote): [Self-service list fields are not proof for an admin action](self-service-list-fields-are-not-proof-for-an-admin-action.md).
