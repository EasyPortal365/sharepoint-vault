---
title: In a self-service list, every field except Author and Editor is a claim — an admin action built on them runs the requester's data with the admin's token
short-title: Self-service list fields are not proof for an admin action
summary: Request, metadata and steward lists that members can write carry client-written requester, status, user id and e-mail fields; an approver's or admin's click then executes them with elevated delegated rights — take identity from the server Author/Editor stamp, resolve people exactly in Graph by id, treat a client "Failed/Approved" status as no decision, and make the confirmation show exactly what will run
tags: [permissions, delegated-tokens, confused-deputy, author-editor, graph-users, approvals, spfx]
applies-to: SharePoint Online — SPFx or Power Apps solutions that keep requests, approvals, group metadata or stewards in a list that ordinary members can edit
last-reviewed: 2026-11-22
---

# In a self-service list, every field except Author and Editor is a claim — an admin action built on them runs the requester's data with the admin's token

> **Bottom line.** A list that anyone may write to (site requests, change requests, group metadata, "who manages this group") is fine as an *inbox*. It becomes a hole when an admin action trusts it: the admin opens the item and clicks, and the admin's delegated token adds an owner, creates a site or removes a member — based on values the requester typed. The only fields SharePoint writes for you are `Author`, `Editor`, `Created` and `Modified`. Everything else (requester e-mail, status, a user's object id in JSON, a display name) is a claim. Take the person from `Author`/`Editor`, resolve every user exactly in Graph (by object id, or exact `mail`/`userPrincipalName` match — never "first search hit"), never accept a client-set status as a decision, and make the confirmation show precisely what will execute.
>
> **Ve zkratce.** Seznam, do kterého smí psát kdokoli (žádosti o web, žádosti o změnu, metadata skupin, „kdo skupinu spravuje“), je v pořádku jako *schránka*. Dírou se stane ve chvíli, kdy mu věří správcovská akce: správce položku otevře a klikne, a jeho delegovaný token přidá vlastníka, založí web nebo odebere člena – podle hodnot, které napsal žadatel. SharePoint sám zapisuje jen `Author`, `Editor`, `Created` a `Modified`. Všechno ostatní (e-mail žadatele, stav, object id uživatele v JSON, zobrazované jméno) je tvrzení. Osobu ber z `Author`/`Editor`, každého uživatele dohledej v Graphu přesně (podle object id nebo přesnou shodou `mail`/`userPrincipalName` – nikdy „první výsledek hledání“), stav nastavený klientem nikdy neber jako rozhodnutí a potvrzení ať ukazuje přesně to, co se provede.

## Symptom

Four variations seen in one review of admin tools built on lists:

- **Forged requester.** A change-of-owner request shows "Requested by: Jane (owner according to the registry)". The requester field was typed by the attacker as Jane's address; the new owner in the JSON is the attacker's account under a trustworthy display name. The approver sees two familiar names and approves. The admin's token makes the attacker an owner and removes Jane.
- **Forged object id.** A "stewards" JSON on a group metadata item holds `{ "id": "<attacker's object id>", "displayName": "Jane Novak", "mail": "jane@contoso.com" }`. "Sync stewards to owners" posts the id to `/groups/{id}/owners/$ref`. The label said Jane, the account added is someone else.
- **Forged status.** The requester patches their own pending request to `Status = Failed`. It disappears from the approval queue; the approver later sees "Retry creation" — without the compliance checks and plan shown for a pending request — and creates a site nobody approved.
- **Prefix search.** The new owner is resolved with a people search and `[0]`. `jan@contoso.com` matches `jan.novak@contoso.com` first.

## Cause

Delegated permissions mean the code runs with whoever clicks. Checks done in the browser ("is the requester the owner?") compare values the requester controls. Item-level security (`ReadSecurity`/`WriteSecurity`) only limits *which* items a user can write — on their own item every column is theirs, and site members with Edit bypass item-level settings entirely.

## What to do

1. **Identity from the server stamp.** Select and expand `Author`/`Editor` (`$select=Author/EMail,Author/Name,Author/Title&$expand=Author`). Compare the stamp, not the requester column, with the owner, and send notifications to the stamp's address. When the claimed name differs from `Author`, show both.
2. **Trust by who last saved.** For metadata items, decide from `Editor`: saved by an app admin or by an owner of the object → trusted; anyone else → do not run admin actions from it, and surface it as a finding ("metadata changed by someone outside admins and owners"). An unreadable stamp or admin list means *unknown*, never trusted.
3. **Resolve people exactly.** For ids, `POST /directoryObjects/getByIds` and require the stored e-mail/UPN to belong to *that* id. For e-mails, `GET /users?$filter=mail eq '…' or userPrincipalName eq '…'` and require exactly one exact match. Reject claims (`i:0#.f|…`, `c:0…`). Show the approver the display name **and** UPN from Graph, and execute with that object.
4. **A status is not a decision.** Before offering "retry", look for an approval record in an append-only audit list whose server `Author` is a **verified approver**: the signed-in approver, a direct member of the app's admin or approver group (read the roster strictly; an unreadable roster counts as empty), or a named approver of that request type. "Author is not the requester" is not enough — any site member can add a row to an append-only list, so a colleague of the requester can write "approved". When approvers are Entra ID groups and you can't resolve another user's membership with the permissions your solution has, accept only admins there. The requester never counts, even as an admin. Without such a record, run the normal approval again (with compliance and plan).
5. **"Mine" by the stamp, too.** "My requests", "my sites" and any automatic grant of read access to the requester come from `Author` (e-mail, login, or the UPN at the end of the claim — the whole UPN, not a suffix match), never from the requester column. Pair a site with its request by id, not by a URL the requester could copy into their own item. Lists, search, sorting and CSV exports show the server requester, too.
6. **Decide on the current item.** Read the item again just before writing the decision; if the status changed (withdrawn, already decided), stop.

## Applies to

Any "request → approve → execute" or "metadata → admin action" flow in SharePoint lists where the writer and the executor are different people.

## See also

- [Editing others' items needs Override list behaviors](editing-others-items-needs-override-list-behaviors.md)
- [Item-level edit rights cover every field](item-level-edit-rights-cover-every-field.md)
