---
title: "`ensureuser` returns the login name — stop looking it up by Email"
tags: [rest-api, security, spfx]
applies-to: SharePoint Online, SharePoint Server
last-reviewed: 2026-08-19
---

# `ensureuser` returns the login name — stop looking it up by Email

> **Bottom line.** `POST /_api/web/ensureuser` resolves an email, a UPN or a claims login and gives you the `LoginName` back in its response. If you throw that response away and re-query `siteusers?$filter=Email eq '<input>'`, every account whose **UPN differs from its Email field** silently fails to resolve — typically `*.onmicrosoft.com` accounts on a tenant with a vanity domain.
>
> **Ve zkratce.** `POST /_api/web/ensureuser` si poradí s e-mailem, UPN i claims loginem a `LoginName` vrátí rovnou v odpovědi. Když ji zahodíš a doptáváš se přes `siteusers?$filter=Email eq '<vstup>'`, každý účet, jehož **UPN se liší od pole Email**, se tiše nenajde – typicky `*.onmicrosoft.com` účty na tenantu s vlastní doménou.

## Symptom

"Add person" in your own UI reports *user not found* for an account that demonstrably exists on the site — while a different address for the very same person works. Nothing is logged, because the underlying `ensureuser` call actually **succeeded**.

## Cause

The common shape of this bug:

```ts
// ensureuser succeeds and returns { LoginName: "i:0#.f|membership|kim@contoso.onmicrosoft.com", ... }
const ok = await post(`${web}/_api/web/ensureuser`, JSON.stringify({ logonName: value }));
if (!ok) return '';

// …and then we ignore it and ask a question that has a different answer
const d = await get(`${web}/_api/web/siteusers?$select=LoginName&$filter=Email eq '${value}'&$top=1`);
return d.value[0]?.LoginName ?? '';
```

`Email` on `SP.User` is the mail attribute synced from the directory. The UPN a person signs in with is a *different* attribute and often a different string. Filtering by `Email` therefore answers "is there a user whose mailbox address is exactly this", not "which user did I just ensure".

The tell is a parameter named `emailOrUpn` (or a placeholder that says *email…*) sitting above code that only handles one of the two.

## Fix

Take the answer from the call that already knows it:

```ts
const ensured = await postJson<{ LoginName?: string }>(
  `${web}/_api/web/ensureuser`, JSON.stringify({ logonName: value })
);
if (ensured?.LoginName) return ensured.LoginName;   // authoritative
if (!ensured) return '';                            // the POST itself failed

// optional fallback only — never the primary path
const d = await get(`${web}/_api/web/siteusers?$select=LoginName&$filter=Email eq '${value.replace(/'/g, "''")}'&$top=1`);
return d?.value?.[0]?.LoginName ?? '';
```

Notes:

- Send `Accept: application/json` (plain). `odata=nometadata` returns 406 on some of these endpoints; with the plain header `LoginName` is still a top-level property.
- `ensureuser` **adds** the user to the site's user information list if they are not there yet. That is usually what you want before a group add — but it is a write, so it needs a form digest and it is not something to call from a read-only path.
- Double apostrophes before URL-encoding if you keep the fallback filter.

## Related

- [Apostrophes in OData literals](odata-string-literals-and-apostrophes.md)
- [A group created by code hides its membership](../security/group-created-by-code-hides-its-membership.md)
