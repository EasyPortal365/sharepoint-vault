---
title: "Multitenant SPA sign-in: classify consent errors by AADSTS code — 90093 is the common one, and your own tenant will never show it"
short-title: Classify consent errors in a multitenant SPA (AADSTS 90093, 90094, 65001…)
summary: A multitenant SPA that signs in with MSAL must turn "Need admin approval" into a clear "ask your Global Administrator" message; match AADSTS65001, 90093 (user consent turned off — the most common case), 90094, 90095, 90099 and the risky-app codes 900941/900981, treat 65004 after the admin consent workflow as "waiting for admin", keep 90090 as a transient error — and test it with unit tests or a second tenant, because once tenant-wide consent exists your own tenant never shows these errors
tags: [permissions, entra, msal, admin-consent, spa, multitenant, error-handling]
applies-to: Microsoft Entra ID, MSAL.js (@azure/msal-browser)
last-reviewed: 2026-11-22
---

# Multitenant SPA sign-in: classify consent errors by AADSTS code — 90093 is the common one, and your own tenant will never show it

> **Bottom line.** When a regular user of another organization signs in to your multitenant single-page app before any admin approved it, MSAL rejects the popup with an AADSTS error, and showing the raw text ("AADSTS90093: An administrator of Contoso has set a policy…") loses that user. Map the codes to one message ("a Global Administrator has to approve the app once — send them this link"): **65001**, **90093**, **90094**, **90095**, **90099**, **900941**, **900981**, plus **65004** when it comes back after the admin consent workflow. **90093** is the one you will see most, because many tenants turn user consent off. A regex built only from the examples in one troubleshooting article misses it. Your own tenant cannot reproduce any of this once tenant-wide consent exists, so cover the mapping with unit tests and use a second tenant for the real check.
>
> **Ve zkratce.** Když se běžný uživatel jiné organizace přihlásí do vaší vícetenantové SPA dřív, než ji schválil správce, MSAL přihlašovací okno odmítne chybou AADSTS. Surový text („AADSTS90093: An administrator of Contoso has set a policy…“) takového uživatele ztratí. Kódy převeďte na jednu hlášku („aplikaci musí jednou schválit globální správce – pošlete mu tento odkaz“): **65001**, **90093**, **90094**, **90095**, **90099**, **900941**, **900981** a **65004**, když se vrátí po pracovním postupu souhlasu správce. Nejčastější je **90093**, protože hodně tenantů má souhlas uživatelů vypnutý. Regulární výraz poskládaný jen z příkladů v jednom článku o řešení potíží ho mine. Ve vlastním tenantu nic z toho nevyvoláte, jakmile tam platí souhlas za organizaci – převod hlídejte jednotkovými testy a skutečnou zkoušku dělejte ve druhém tenantu.

## Symptom

A free "check your tenant" page (SPA, MSAL.js popup, authority `organizations`) works perfectly when the developer tests it with their own Global Administrator. Real visitors from other companies report "it just says Need admin approval" or see an English AADSTS message with no next step. The page did classify consent errors, but only `AADSTS65001` and `AADSTS90094`. The visitors' tenants had user consent turned off, which returns `AADSTS90093` instead, so they landed in the generic "something went wrong" branch.

## Cause

There is no single "consent required" code. Microsoft Learn documents them across two pages: *Microsoft Entra authentication and authorization error codes* and *Unexpected error when performing consent to an application*.

| Code | Meaning (Microsoft Learn) | What the user should read |
|---|---|---|
| AADSTS65001 | DelegationDoesNotExist – the user or admin hasn't consented | ask a Global Administrator |
| AADSTS90093 | an administrator set a policy that prevents users from granting the permissions (user consent turned off) | ask a Global Administrator |
| AADSTS90094 | AdminConsentRequired – the permissions need an admin; also used when the request is detected as risky or user assignment is required | ask a Global Administrator |
| AADSTS90095 | AdminConsentRequiredRequestAccess – admin consent workflow interrupt ("request approval") | request sent, wait for the admin |
| AADSTS90099 | the app hasn't been authorized in the tenant (partner delegated admin scenario) | ask a Global Administrator of that tenant |
| AADSTS900941 / 900981 | the app is considered risky (e.g. no verified publisher); only an admin can consent | ask a Global Administrator; verify your publisher |
| AADSTS65004 | UserDeclinedConsent; also sent on purpose after a user submits an admin consent request and clicks **Back to app** | if it follows the admin consent workflow: waiting for the admin |
| AADSTS90090 | intermittent problem recording the permissions | transient, try again – **not** an admin problem |

MSAL.js surfaces the code in `errorCode` / `errorMessage` / `subError` of the thrown `AuthError`, so match the concatenation of these fields, not only `errorCode`. For popups `errorCode` is often just `access_denied` or `consent_required`, and the AADSTS number is in `errorMessage`.

## Fix

```ts
type SignInFailure = 'needs-admin' | 'cancelled' | 'popup-blocked' | 'other';

export function signInFailure(e: unknown): SignInFailure {
  const o = (e || {}) as { errorCode?: string; errorMessage?: string; subError?: string; message?: string };
  const all = [o.errorCode, o.errorMessage, o.subError, o.message].filter(Boolean).join(' ');
  // \b keeps 90094 from matching 900941 and vice versa
  if (/AADSTS(65001|90093|90094|90095|90099|900941|900981)\b|consent_required|admin.?consent/i.test(all)) return 'needs-admin';
  if (/user_cancelled|user_canceled|access_denied/i.test(all)) return /AADSTS65004/.test(all) ? 'needs-admin' : 'cancelled';
  if (/popup_window_error|empty_window_error|popup.*block/i.test(all)) return 'popup-blocked';
  return 'other';
}
```

Then show one plain-language message for `needs-admin` and give the user something to *do*: a link to the page they can forward to their Global Administrator (optionally carrying where the result should go), or the `…/{tenant}/v2.0/adminconsent?client_id=…` URL for the admin. Never put the raw AADSTS text first. Keep it in a "details" line for support.

## Why your own tenant can't show it

Once a Global Administrator of *your* tenant granted tenant-wide consent (and you need that to develop the app at all), every account in that tenant signs in silently. No consent prompt appears, and no 65001/90093 comes back, even for a non-admin. The only ways to see the real flow:

- a **second tenant** without consent (a developer or trial tenant), signed in once as a regular user and once as a Global Administrator who hasn't consented yet;
- deleting the app's **enterprise application** (service principal) in your tenant. That removes the consent for everyone, so it is a destructive step; don't do it in a tenant where people use the app.

Cover the classifier with unit tests that feed real error strings for every code above. Testing only the two codes you happened to read about is exactly how 90093 slips through.
