---
title: An SPFx web part that calls an intranet API makes Chrome and Edge ask every user for local network access
short-title: SPFx calling an intranet API hits Local Network Access
summary: A `*.sharepoint.com` page fetching a host that resolves to a private IP is a local network request – Chrome (from 142) and Edge prompt every user and a refusal is a bare `Failed to fetch`; pre-allow the SharePoint origin by policy and still plan for CORS, trusted HTTPS, VPN-only reach and per-user tokens – or let a connector inside the network write to a list through `Sites.Selected`
tags: [spfx, security, cors, browser, local-network-access, on-premises, entra-id]
applies-to: SharePoint Online, SPFx, Google Chrome 142+ and Microsoft Edge (state as of 2026-11)
last-reviewed: 2026-11-12
---

# An SPFx web part that calls an intranet API makes Chrome and Edge ask every user for local network access

> **Bottom line.** SharePoint Online is a public origin, so a `fetch` from a web part to a host that resolves to a private IP address is a *local network request*: Chrome (from version 142) and Edge ask every user for permission, and a refused permission surfaces as a bare `TypeError: Failed to fetch`. An admin can pre-allow the SharePoint origin by browser policy — but the browser-direct call still needs CORS on the API, a certificate the device trusts, a user on the internal network or VPN, and per-user Entra ID tokens instead of a shared system token. When any of that is a problem, put a connector inside the network that writes the data into a SharePoint list.
>
> **Ve zkratce.** SharePoint Online je veřejný origin, takže `fetch` z webpartu na host, který se přeloží na privátní IP adresu, je *požadavek do lokální sítě*: Chrome (od verze 142) i Edge se každého uživatele zeptají na povolení a odmítnuté povolení skončí holým `TypeError: Failed to fetch`. Správce může origin SharePointu povolit předem politikou prohlížeče – přímé volání z prohlížeče ale dál potřebuje CORS na API, certifikát, kterému zařízení věří, uživatele ve vnitřní síti nebo na VPN a tokeny Entra ID za každého uživatele místo sdíleného systémového tokenu. Když něco z toho nejde, dej do sítě konektor, který data zapisuje do seznamu SharePointu.

## Symptom

A web part on `https://contoso.sharepoint.com/sites/operations` reads an internal REST API:

```ts
const res = await fetch('https://erp.corp.contoso.com/api/orders?open=true');
```

Inside the company network `erp.corp.contoso.com` resolves to `10.20.30.40`. It worked in testing; after a browser update, every user gets a permission prompt the first time the page loads — in Chrome it reads *"Look for and connect to any device on your local network"*. Users who refuse it get an empty web part and this in the console:

```
TypeError: Failed to fetch
```

No CORS message, no HTTP status. A user who is simply off the VPN gets exactly the same error, so the two cases cannot be told apart from the exception.

## Cause

Chromium's **Local Network Access** (LNA) sorts every destination into *public*, *local* or *loopback* by the IP address it **resolves to**, not by its name. Per the [Chrome announcement](https://developer.chrome.com/blog/local-network-access), "a *local network* is any destination that resolves to addresses reserved for local use" — the RFC 1918 private ranges, link-local, IPv6 unique-local (`fc00::/7`); the [WICG specification](https://wicg.github.io/local-network-access/) maps `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` and `100.64.0.0/10` to *local*. A request from a public origin to a local or loopback destination needs the user's permission, and if the user denies it the spec returns a network error — which `fetch` reports as the generic `TypeError`.

- `*.sharepoint.com` is public. An ordinary SPFx web part runs in the page, so the requesting origin is the SharePoint origin.
- The hostname does not save you: a normal-looking DNS name that resolves to `10.x` is a local destination, and so is a private IP literal.
- **Versions:** Google says the prompt "is launching in Chrome 142", and Microsoft's [eCDN guidance](https://learn.microsoft.com/en-us/ecdn/how-to/configure-local-network-access-policy) states that Chrome enforces the restrictions as of Chrome 142. Edge [documents the same prompt](https://support.microsoft.com/en-US/edge/control-a-website-s-access-to-the-local-network-in-microsoft-edge) and a *Local network access* site permission (Settings → Privacy, search, and services → Site permissions); that page names no version.

**The mixed-content wrinkle.** An HTTPS page cannot normally call `http://`. LNA exempts a permission-gated local request from mixed-content blocking only when the browser knows *before* resolving the name that the target is local: a private IP literal (`http://10.20.30.40/…`), a `.local` hostname, or a `fetch` annotated with `targetAddressSpace: "local"`. A regular DNS name over `http://` stays blocked — in Google's words, a "public domain is not exempt from mixed content, even if it resolves to a local network address". Do not build on the exemption; serve the API over HTTPS.

## Fix

There are two workable shapes. Pick deliberately — most of the cost of the first one is not in the code.

### A. Keep the call in the browser, and make every condition explicit

**1. Pre-allow the SharePoint origin by policy** so managed devices never prompt. Edge has [`LocalNetworkAccessAllowedForUrls`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/localnetworkaccessallowedforurls) (Edge 140+ on Windows and macOS, Group Policy path *Administrative Templates/Microsoft Edge/Network settings*); Microsoft's eCDN guide sets the same policy name for Google Chrome under the Chrome policy key:

```
HKLM\SOFTWARE\Policies\Microsoft\Edge\LocalNetworkAccessAllowedForUrls\1 = https://contoso.sharepoint.com
HKLM\SOFTWARE\Policies\Google\Chrome\LocalNetworkAccessAllowedForUrls\1 = https://contoso.sharepoint.com
```

Edge 146+ adds split policies — [`LocalNetworkAllowedForUrls`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/localnetworkallowedforurls) for private IP addresses and [`LoopbackNetworkAllowedForUrls`](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/loopbacknetworkallowedforurls) for `127.0.0.1`, `::1` and `localhost`, each with a `…BlockedForUrls` counterpart. When an origin matches several, Edge applies them in this order:

1. `LocalNetworkBlockedForUrls`
2. `LocalNetworkAllowedForUrls`
3. `LoopbackNetworkBlockedForUrls`
4. `LoopbackNetworkAllowedForUrls`
5. `LocalNetworkAccessBlockedForUrls`
6. `LocalNetworkAccessAllowedForUrls`

So a block in one of the newer policies beats your allow in the older one — read the customer's existing browser baseline before you promise "no prompt".

Two things the policy does **not** do:

- It is **per origin, not per web part.** Every page and every script on `https://contoso.sharepoint.com` gets the exemption — other solutions, tenant-wide extensions, anything that runs there can now reach the internal network from a managed browser without asking. That is the same scope a user's own *Allow* has, only silent and fleet-wide.
- It reaches **managed browsers only.** A personal laptop, a partner's device or a second browser still prompts (and usually cannot reach the API anyway).

**2. CORS on the API.** The permission and CORS are separate checks. The API has to answer the preflight and return `Access-Control-Allow-Origin: https://contoso.sharepoint.com` (the exact origin), with `Authorization` in `Access-Control-Allow-Headers` if you send a token. Verify it the way the browser sees it — [a header that is merely present proves nothing](../azure-functions/verifying-cors-by-header-presence-passes-every-origin.md). There is no SharePoint-side proxy to fall back on: [`SP.WebProxy` is add-in-only](webproxy-is-add-in-only.md).

**3. HTTPS with a certificate the device trusts.** An internal CA is fine when its root is deployed to every device that opens the page; anything else fails as the same opaque `Failed to fetch`.

**4. Reach.** The call works only where the name resolves and the route exists — on the internal network or VPN. At home without VPN, or in the mobile apps, the web part needs a real state ("Connect to the company network or VPN; if you are connected, allow local network access for this site"), because it cannot distinguish that case from a refused permission.

**5. No system token in the browser.** Anything the web part holds — a value in the bundle, in a list, in a tenant property, or fetched at runtime — is readable by every user who can open the page (F12), and by every other script on the origin. An API key or client secret for system-to-system access shipped this way is effectively published to all employees. That leaves two honest models:

- **Network-only protection.** The API is read-only, the data is fine for anyone on the network, and the network boundary is the control. Write that down as a decision, not as an accident.
- **Per-user Entra ID tokens.** Register the API in Entra ID, request it in `webApiPermissionRequests`, have an admin approve it under *API access*, and call it with [`AadHttpClient`](https://learn.microsoft.com/en-us/sharepoint/dev/spfx/use-aadhttpclient). The API validates the token (issuer, audience, signature) and authorizes **the user**, by roles or groups.

```json
"webApiPermissionRequests": [
  { "resource": "Contoso ERP API", "scope": "user_impersonation" }
]
```

```ts
import { AadHttpClient } from '@microsoft/sp-http';

const client = await this.context.aadHttpClientFactory
  .getClient('api://00000000-0000-0000-0000-000000000000');
const res = await client.get(
  'https://erp.corp.contoso.com/api/orders?open=true',
  AadHttpClient.configurations.v1
);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
```

The approval lands on the tenant-wide SPFx principal, not on your solution ([grants are tenant-wide](graph-permission-grants-are-tenant-wide.md)) — any SPFx code in the tenant can then get a token for your API, so authorize on the user, never on "the call came from our web part". The app registration has to exist before the `.sppkg` is uploaded ([otherwise the request is "not valid"](custom-api-permission-request-invalid.md)), and an on-premises API that validates Entra ID tokens needs the tenant's signing keys from Entra ID — agree with the network team how the server gets them.

### B. Let a connector inside the network write to SharePoint

A small service on a server in the customer's network calls the internal API locally and writes the result into a SharePoint list through Microsoft Graph; the web part reads the list with ordinary SharePoint REST.

- The connector authenticates as an Entra ID app with the application permission **`Sites.Selected`**, granted on that one site only ([overview](https://learn.microsoft.com/en-us/graph/permissions-selected-overview)), with a certificate that never leaves the server. The tenant-wide admin consent needs a role above Application Administrator ([who can approve it](../permissions/graph-api-access-approval-needs-global-admin.md)), and the per-site grant is a Graph call the Azure CLI cannot make ([use the Graph PowerShell SDK](../graph/az-cli-cannot-grant-sites-selected.md)).
- **What you gain:** no prompt and no browser policy, no CORS, no certificate work on the API, no VPN dependency (it works from home and in the mobile apps), outbound HTTPS from the connector only, and SharePoint permissions on the list decide who sees what. The API never has to understand Entra ID tokens.
- **What you pay:** the data is a copy (as fresh as the sync interval), it now lives in Microsoft 365 (classification, retention), writing back needs a queue — a "requests" list the connector polls — and someone has to run the connector: monitoring, certificate renewal, an alert when it stops.

| | A. Browser calls the API | B. Connector writes to a list |
|---|---|---|
| Prompt / browser policy | on every device, or a policy on managed ones | none |
| Off the VPN, mobile apps | no | yes |
| CORS + trusted certificate on the API | required | not needed |
| Identity | per-user Entra ID token, or network only | app with `Sites.Selected` on one site |
| Freshness | live | sync interval |
| Where the data goes | only to the user's browser | copied into SharePoint |

## Notes

- **Facts as of 2026-11**, taken from the pages linked above. The policy names are still moving (the split policies arrived with Edge 146); re-read the Edge and Chrome policy references before a rollout.
- **Loopback is covered too.** A SharePoint page fetching `http://127.0.0.1` falls under the same permission — see [getting bulk data into a SharePoint page from the console](../tooling/getting-bulk-data-into-a-sharepoint-page-from-the-console.md), which observed the plain `Failed to fetch` in October 2026.
- **Firefox:** Microsoft's eCDN guidance says Firefox has the restriction only in Nightly so far and plans equivalent enterprise policies when it ships (checked 2026-11).
- **Not tested here:** the same eCDN page notes that the Teams desktop app "already has access to local network resources" — that statement is about eCDN; what it means for an SPFx web part hosted in a Teams tab has not been verified. Isolated web parts, which run in an iframe on a separate origin, were not tested either.
