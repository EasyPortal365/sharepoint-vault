---
title: "Greeting by first name: the first word of the display name is often the surname — read `FirstName` from the User Information List, no Graph permission needed"
short-title: "First name for a greeting without Graph: User Information List `FirstName`"
summary: Tenants with display names like „Surname Firstname EXT“ make a first-word greeting address people by surname; currentuser Id + SiteUserInfoList/items(Id)?$select=FirstName needs no Graph scope (SharePoint REST only), GetMyProperties as a fallback, and the name stays blank until it arrives
tags: [rest-api, user-profile, user-information-list, spfx, ux]
applies-to: SharePoint Online (REST from SPFx)
last-reviewed: 2026-11-27
---

# Greeting by first name: the first word of the display name is often the surname — read `FirstName` from the User Information List, no Graph permission needed

> **Bottom line.** „Good morning, *first word of `displayName`*“ only works where display names are „Firstname Surname“. Many organizations use „Surname Firstname“, often with suffixes („Novak Jan EXT“, „Smith John (Contractor)“) – the greeting then says „Good morning, Novak“. The real first name is in the profile, and you can read it **without any Graph permission**: `/_api/web/currentuser?$select=Id`, then `/_api/web/SiteUserInfoList/items({Id})?$select=FirstName`. Fall back to `SP.UserProfiles.PeopleManager/GetMyProperties`, then to an admin-chosen word of the display name. Don't render the name until the value arrives, or the surname flashes first.
>
> **Ve zkratce.** „Dobré ráno, *první slovo `displayName`*“ funguje jen při formátu „Jméno Příjmení“. Řada organizací má „Příjmení Jméno“, často s příponou („Novák Jan EXT“) – pozdrav pak osloví příjmením. Skutečné křestní jméno je v profilu a přečte se **bez oprávnění Graphu**: `/_api/web/currentuser?$select=Id` a pak `/_api/web/SiteUserInfoList/items({Id})?$select=FirstName`. Záloha `GetMyProperties`, pak správcem zvolené slovo zobrazovaného jména. Jméno nevykreslovat, dokud hodnota nedorazí – jinak problikne příjmení.

## Measured (SharePoint Online, 2026-11-27, own tenant)

- `SiteUserInfoList/items({currentuser Id})?$select=FirstName` returned HTTP 200 with the profile first name for an account whose display name carries a suffix („Firstname Surname - GA“) – SharePoint REST only, no Graph scope, no admin consent.
- `GetMyProperties` returned the same value in the `FirstName` profile property.

Not measured (assumptions):

- The measuring account was a tenant admin. A site member without admin rights was not measured; the code is written fail-safe for that case (empty value → fallback).
- How quickly a changed `givenName` reaches the User Information List – the sync is background work and can lag.
- Accounts without `givenName` (shared mailboxes, service accounts) give an empty value – that is why the fallbacks exist.

## The pattern

```ts
async function loadMyFirstName(webUrl: string): Promise<string> {
  const web = webUrl.replace(/\/+$/, '');
  try {
    const me = await get(`${web}/_api/web/currentuser?$select=Id`);
    const row = await get(`${web}/_api/web/SiteUserInfoList/items(${me.Id})?$select=FirstName`);
    const fn = String(row?.FirstName || '').trim();
    if (fn) return fn;
  } catch { /* fall through */ }
  try {
    const p = await get(`${web}/_api/SP.UserProfiles.PeopleManager/GetMyProperties?$select=UserProfileProperties`);
    const hit = (p?.UserProfileProperties || []).find((x: any) => x.Key === 'FirstName');
    return String(hit?.Value || '').trim();
  } catch { return ''; }   // greeting is cosmetic: never fail the page
}
```

- Cache the result in `sessionStorage` per web + user, so the greeting doesn't cost two requests on every navigation.
- When falling back to the display name, strip what is not a name before taking a word: text after „ - “ or „ | “, brackets, e-mail addresses, digits, titles (Ing., Dr.), suffixes like EXT / Guest / Admin, short all-caps abbreviations.
- Let an admin choose the fallback once for the organization (first name from profile / first word / second word / no name) instead of guessing per user.

## Rule

- Never derive a first name from the first word of `displayName`.
- Read `FirstName` from the User Information List; no Graph permission is needed for it.
- Keep the name blank until it is known; a wrong name is worse than none.
