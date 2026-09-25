---
title: "Rolling out required tokens on your own API: the \"calls without a token\" counter measures every client, not just the app you fixed"
short-title: "The \"without a token\" counter measures every client"
summary: "You add Entra ID token validation to an API your SPFx solutions call, ship it in soft mode and wait for \"calls without a token\" to reach zero — it never does, because a shared npm package, a second solution, a diagnostic \"test connection\" call and a secondary host (list command set, application customizer) call the same endpoint without the header. Inventory callers by endpoint, not by app; create the token source once per app root and pass it as a value (a module singleton does not cross bundle boundaries); guard each client with a source-level test"
tags: [spfx, azure-functions, entra-id, aadtokenprovider, authentication, rollout]
applies-to: SharePoint Online, SPFx (AadTokenProvider / AadHttpClient) calling your own Entra-protected API
last-reviewed: 2026-09-25
---

# Rolling out required tokens on your own API: the "calls without a token" counter measures every client

> **Bottom line.** When you move your own API from "token optional" to "token required", the only honest switch signal is traffic: count the calls that arrive without a token and flip the switch at zero. That counter measures the **endpoint**, so every caller counts — the shared npm package two other solutions bundle, the direct `fetch` in a settings page, the "test connection" button, the list-view command set that renders the same panel. Fixing the app you were working on moves the number, but it will never reach zero. Inventory callers by endpoint across all your repositories, create the token source once per app root and hand it down as a value, and give every client a test that fails on a call without the header.
>
> **Ve zkratce.** Když vlastní API přepínáte z „token volitelný“ na „token povinný“, jediný poctivý signál k přepnutí je provoz: počítat volání bez tokenu a přepnout při nule. To počítadlo ale měří **endpoint**, takže se počítá každý volající – sdílený npm balíček, který si zabalí dvě další řešení, přímý `fetch` ve stránce nastavení, tlačítko „otestovat připojení“, tlačítko v zobrazení seznamu, které vykresluje stejný panel. Oprava appky, na které zrovna pracujete, číslo sníží, ale k nule nikdy nedojde. Volající inventarizujte podle endpointu napříč všemi repozitáři, zdroj tokenu vytvořte jednou v kořeni appky a předávejte ho dolů jako hodnotu a každému klientovi dejte test, který spadne na volání bez hlavičky.

## Symptom

The API is an Azure Function that your SPFx web part calls with a bearer token from `AadTokenProvider`. Validation ships in a soft mode: a missing token passes, an invalid one is rejected, and every few minutes the function logs how many requests came with and without a token. The plan is to flip to *required* once the second number is zero.

The web part sends the token, the release is verified, and the log still says:

```
[auth] last 5 min: with token 212, without token 37, rejected 0
```

It stays like that for days. Flipping the switch anyway would break whatever those 37 calls are — and nothing tells you which features they belong to.

## Cause

The switch was prepared per app, but the counter counts per endpoint. In our case the same function was called by:

| Caller | Why it had no token |
|---|---|
| A shared npm package (AI helper) bundled by two other solutions | It was ported from the original app before tokens existed and built its own `fetch` calls |
| Direct `fetch` calls in one of those solutions (usage card, day summary, model check) | Written against the endpoint, not through the service that got fixed |
| The original app's own secondary paths — a "sources" tab, a "check model" button | Added by hand next to the wired service |
| The same panel rendered by a list-view command set | The host never passed `aadTokenProviderFactory`, so the panel's token source stayed unconfigured |

Two details made it worse:

- **The free-looking design was not free.** The package's service already took the web part context as its first constructor argument, so deriving the token from it looked like a fix without touching any consumer. Reading the call sites showed every consumer passing `null` there. Read the call sites before you build on a parameter.
- **A module-level singleton does not survive a bundle boundary.** SPFx solutions, extension shells and runtime libraries are separate webpack bundles. Configuring a token singleton in one bundle leaves the copy in the other bundle empty — the second host keeps calling without a token, silently.

## Fix

1. **Inventory by endpoint.** Grep every repository — solutions, shared packages, scripts — for the setting that holds the API address and for the endpoint paths (`/chat`, `/usage`, …). Diagnostic calls count too.
2. **One token source per app, passed as a value.** Build it once where the web part context enters your code (the web part, or the runtime library's `mount`) and hand it down through a React context or constructor parameters. Services take it as a **required** parameter, so a new call path without it does not compile.

   ```ts
   /** `exp` only for the cache — the API validates the signature, the client never needs to. */
   function expiryOf(token: string): number {
     try {
       const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
       return typeof p.exp === 'number' ? p.exp * 1000 : 0;
     } catch { return 0; }
   }

   export function createTokenHeaders(getToken: ((resource: string) => Promise<string>) | null, resource: string) {
     let cached: { token: string; expiresAt: number } | null = null;
     let inflight: Promise<Record<string, string>> | null = null;
     return function headers(): Promise<Record<string, string>> {
       if (!getToken || !resource) return Promise.resolve({});          // fail open: call as before
       if (cached && cached.expiresAt > Date.now() + 60000) return Promise.resolve({ Authorization: 'Bearer ' + cached.token });
       if (!inflight) {
         inflight = getToken(resource).then(
           t => { cached = { token: t, expiresAt: expiryOf(t) || Date.now() + 300000 }; return { Authorization: 'Bearer ' + t }; },
           () => ({})                                                     // no consent yet: call without the header
         ).finally(() => { inflight = null; });
       }
       return inflight;
     };
   }
   // in the web part / library mount:
   // const headers = createTokenHeaders(r => ctx.aadTokenProviderFactory.getTokenProvider().then(p => p.getToken(r)),
   //                                    'api://<your-api-app-id-uri>');
   ```

3. **Guard every client with a source-level test.** Find each `fetch` whose URL starts with the API address and fail when its options don't spread the token headers; find each construction of the API service and fail when it gets no token source. Plant one call without the header in the test itself to prove the detector can fail.
4. **Treat 401/403 as its own state.** A card that shows "service unavailable" or "needs an update" on 401 hides exactly the problem this rollout creates.

## Notes

- Keep soft mode until the counter is zero for a whole business cycle; sites pinned to older client versions keep sending old traffic.
- Related: [Custom API permission request shows as invalid](custom-api-permission-request-invalid.md) · [Graph permission grants are tenant-wide](graph-permission-grants-are-tenant-wide.md).
