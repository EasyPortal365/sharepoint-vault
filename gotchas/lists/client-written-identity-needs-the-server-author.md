---
title: An evidence record whose "who" is written by the browser proves nothing — compare it with the server-stamped Author, and compare on the sign-in name too
short-title: Client-written identity vs. the server-stamped Author
summary: "Append-only lists let any contributor add a row with someone else's name in a text column; `Author` is stamped by SharePoint. Compare the two — but against `Author/Name` (the sign-in claim) as well, or every user whose e-mail differs from their UPN looks like a forger"
tags: [lists, permissions, audit, rest-api, security]
applies-to: SharePoint Online
last-reviewed: 2026-10-04
---

# An evidence record whose "who" is written by the browser proves nothing — compare it with the server-stamped Author, and compare on the sign-in name too

> **Bottom line.** If an audit list (confirmations, sign-offs, votes) stores the person in a text column the page fills in, anyone who may add rows can add one under a colleague's name — append-only permissions do not stop that. SharePoint stamps `Author` itself; compare the claimed name with it and do not count rows where they differ. Compare against `Author/Name` (the claim, which carries the UPN) as well as `Author/EMail` and `Author/Title`, otherwise every user whose e-mail is not their UPN is flagged on their genuine records.
>
> **Ve zkratce.** Když auditní seznam (potvrzení, schválení, hlasy) drží člověka v textovém sloupci, který vyplní stránka, zapíše řádek pod cizím jménem každý, kdo smí přidávat – režim „jen přidávat" tomu nezabrání. `Author` razí SharePoint sám; porovnej s ním zapsané jméno a řádky, kde nesedí, nezapočítávej. Porovnávej i s `Author/Name` (claim s UPN), nejen s e-mailem a zobrazovaným jménem – jinak vyjde jako podvrh každý pravý záznam člověka, jehož e-mail není jeho UPN.

## Symptom

A "who confirmed what" list runs with add-only permissions for every recipient. The page writes `UserUpn = <current user>` and the app counts confirmations per `UserUpn`. A user who knows the REST API posts a row with `UserUpn = colleague@contoso.com`, and the colleague now shows as compliant.

## Cause

Every column in the POST body is the client's word. Only the system fields — `Author`, `Created`, `Editor`, `Modified`, `_UIVersionString` — are set by the server; a contributor cannot override `Author` through REST (that needs `ManageLists`).

## Fix

1. Read the author with the rows: `$select=…,Author/Id,Author/Title,Author/EMail,Author/Name&$expand=Author`.
2. Treat a row as valid only if the claimed name matches the author on **any** of:
   - `Author/Name` after the last `|` (`i:0#.f|membership|jan@contoso.onmicrosoft.com` → the UPN; guests look like `jan_gmail.com#ext#@contoso.onmicrosoft.com`),
   - `Author/EMail`,
   - `Author/Title`,
   case-insensitive.
3. Do not count non-matching rows, but do not hide them either — show them as "not counted, needs checking" in the UI and in exports. A rename can produce a legitimate mismatch.
4. Rows you create on someone's behalf on purpose (sample data, an admin importing paper records) must carry their own marker (e.g. a method value) and be exempted explicitly.
5. A row without author data is "unknown", not "forged" — never flip it either way.

```js
const login = n => (n || '').substring((n || '').lastIndexOf('|') + 1).toLowerCase();
const norm = s => (s || '').trim().toLowerCase();
const matches = (claimed, a) => !!a && [login(a.Name), norm(a.EMail), norm(a.Title)].indexOf(norm(claimed)) !== -1;
```

## Measured / why the sign-in name matters

The first version compared only with `Author/Title` and `Author/EMail`. The page wrote the user's e-mail when present and the UPN otherwise; in tenants where the e-mail is an alias or another domain, or for accounts without a mailbox, the genuine record never matched — a rule that "does not count mismatches" would have silently zeroed those people. `Author/Name` is the only author field that carries the UPN.

## Notes

- This is tamper-*evidence*, not tamper-*proof*: site owners and anyone with `ManageLists` can still rewrite `Author`.
- Aggregations over thousands of rows need only `Author/*`, not the full stamp set — keep the payload small.
