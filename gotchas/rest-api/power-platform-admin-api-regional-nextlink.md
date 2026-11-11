---
title: "Power Platform admin API returns nextLink on a regional host – a guard that only knows api.powerapps.com breaks paging for US tenants"
short-title: Power Platform admin API nextLink goes to a regional host
summary: Admin listings page through `unitedstates.api.powerapps.com` (and other one-label regional hosts); a token guard that allows only the global host rejects page two, and you never see it on a small tenant – allow exactly one DNS label in front of the three admin hosts, nothing else
tags: [power-platform, power-apps, power-automate, rest-api, paging, nextlink, security, spfx, sovereign-cloud]
applies-to: Power Platform admin APIs (api.bap.microsoft.com, api.powerapps.com, api.flow.microsoft.com) called from a browser or SPFx
last-reviewed: 2026-11-11
---

# Power Platform admin API returns nextLink on a regional host – a guard that only knows api.powerapps.com breaks paging for US tenants

> **Bottom line.** Paged admin listings (apps, connections, flows) return `nextLink` on a **regional instance** – `https://unitedstates.api.powerapps.com/…` for a tenant in the United States. If you guard where the Bearer token may go (you should – `nextLink` is an absolute URL from a response), allow `https` + the exact admin host **or exactly one DNS label in front of it**. A guard that only knows `api.powerapps.com` rejects page two, and on a tenant whose listings fit on one page you never see it.
>
> **Ve zkratce.** Stránkované admin výpisy (aplikace, připojení, toky) vracejí `nextLink` na **regionální instanci** – u tenantu v USA `https://unitedstates.api.powerapps.com/…`. Strážce, kam smí odejít token, má povolit `https` a přesný admin host **nebo právě jedno DNS návěští před ním**. Strážce, který zná jen `api.powerapps.com`, odmítne druhou stránku – a na tenantu, kde se výpis vejde na jednu stránku, to neuvidíte.

## Symptom

A browser-side scan of Power Platform works on your own tenant and fails on a customer tenant in another region with your own guard's error, for example:

```
unexpected address: https://unitedstates.api.powerapps.com/providers/Microsoft.PowerApps/scopes/admin/…
```

The first request to `https://api.powerapps.com/…/apps` succeeded; the failing URL is the `nextLink` of that response.

## Cause

The global hosts route to the tenant's regional instance, and the continuation link points straight at it. Microsoft documents the hosts with a wildcard (*Power Apps – Required services*: `api.bap.microsoft.com` and `*.api.bap.microsoft.com`), and regional instances are named with a single label in front of the host (`unitedstates.`, `europe.`, `asia.`, `unitedstatesfirstrelease.` … – the same naming as the Power Apps checker API geographies).

Measured from a SharePoint page in a tenant in Europe (2026-11-11), with the token SPFx issues for `https://service.powerapps.com/`:

| Request | Result |
|---|---|
| `GET https://api.powerapps.com/…/environments/{env}/apps` | 200 |
| same path on `europe.`, `emea.`, `unitedstates.api.powerapps.com` | 200, no CORS error |
| `GET https://europe.api.bap.microsoft.com/…/environments` | 200 |
| `GET https://europe.api.powerapps.com/…/connections` | 200 |
| admin flows on `api.`, `emea.`, `unitedstates.api.flow.microsoft.com` (token for `service.flow.microsoft.com`) | 401 everywhere, readable (CORS fine – see the linked article for why 401) |

So the same token and the same CORS policy apply on the regional hosts. The default environment had no apps – which is exactly why `nextLink` never showed up there.

## Fix

```ts
// https only; the exact admin host, or ONE DNS label in front of it. No port, no userinfo,
// no other suffix – not even another Microsoft domain.
const PP_ADMIN = /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)?(?:api\.bap\.microsoft\.com|api\.powerapps\.com|api\.flow\.microsoft\.com)\//i;

async function get(url: string, token: string): Promise<unknown> {
  if (!PP_ADMIN.test(url)) throw new Error('host: ' + hostOf(url));   // store the host, not a truncated URL
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/** Host only – `[^/]+` would read `https://evil.com?x.sharepoint.com` as a SharePoint host. */
function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : '';
}
```

What it must reject (put these in a unit test): `https://api.powerapps.com.evil.com/`, `https://evilapi.powerapps.com/`, `https://a.b.api.powerapps.com/`, `http://api.powerapps.com/`, `https://api.powerapps.com:8443/`, `https://api.powerapps.com@evil.com/`, `https://evil.com/?r=https://api.powerapps.com/`, `https://graph.microsoft.com/…`.

Test the paging path with a **fake `fetch`** whose first page returns `nextLink` on `unitedstates.api.powerapps.com` (must be read, token sent) and another whose `nextLink` points at a foreign host (must throw, nothing sent there). Your own tenant will not produce either case.

## Government and national clouds

GCC High, DoD and 21Vianet have their own admin hosts (`*.gov.api.bap.microsoft.us`, `high.…`, `*.api.bap.appsplatform.us`, `*.api.bap.partner.microsoftonline.cn`, `*.powerapps.us`, `*.powerapps.cn`, `*.powerautomate.cn`) and their own sign-in. A commercial-cloud token does not belong there. Recognise them (and SharePoint on `*.sharepoint.us`, `*.sharepoint-mil.us`, `*.sharepoint.cn`) and say "this cloud isn't supported" instead of "unexpected address". GCC (moderate) runs SharePoint on `*.sharepoint.com` and can't be told apart by host.

## Also

- Don't put the raw error string into stored data in the UI language. Store a code (`host: <host>`) and build the sentence when you display it – the person reading the stored result may use another language than the person who ran the scan.

## Related

- [Power Automate admin flows API returns UserImpersonationScopeMissing from SPFx](../spfx/power-automate-admin-api-unreachable-from-spfx.md)
- [Read all items from a large list – paging done right](../../snippets/rest/get-all-list-items-paged.md)

**Sources:** Microsoft Learn – *System requirements, limits, and configuration values for Power Apps* (Required services), *IP address configuration for Power Automate*, *Use the Power Apps checker web API* (geographies), *Power Apps US Government*, *Microsoft 365 U.S. Government GCC High / DoD endpoints*; live measurement 2026-11-11.
