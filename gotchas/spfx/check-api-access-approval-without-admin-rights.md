---
title: Check whether an SPFx Graph permission is approved without admin rights
short-title: API access approval, checked without admin rights
summary: "Guests and ordinary users cannot open API access in the SharePoint admin center, and `SP.OAuth.Token/Acquire` answers 400 “Resource is not allowed” – but the Graph token SPFx caches in `localStorage` lists its granted scopes in plain text"
tags: [spfx, graph, permissions, troubleshooting]
applies-to: SharePoint Online, SharePoint Framework (AadHttpClient / MSGraphClient)
last-reviewed: 2026-11-20
---

# Is the permission approved? Read the scopes SPFx already received

> **Bottom line.** When an SPFx feature fails with 403 and you are not a SharePoint or Global Administrator in that tenant, you cannot open *Advanced › API access* to see whether a scope was approved. You do not need to: open any page where the solution has run once, and read the `target` of the cached Microsoft Graph access token in `localStorage`. It is the list of scopes the tenant actually granted, readable without decoding or printing the token.
>
> **Ve zkratce.** Když funkce SPFx padá na 403 a v tenantu nejste správce, stránku *Přístup k rozhraní API* neotevřete. Nepotřebujete ji: na stránce, kde řešení aspoň jednou běželo, je v `localStorage` uložený token Graphu a jeho pole `target` vypisuje oprávnění, která tenant skutečně vydal – bez dekódování a bez vypsání tokenu.

## Symptom

- A feature that needs a newly added delegated scope (for example `ChatMessage.Send`) returns **401/403** after the customer uploaded the new `.sppkg`.
- You work in the tenant as a guest or a normal user. The admin center refuses you (for a guest: *“External sharing is disabled for …-admin.sharepoint.com”*).
- Asking SharePoint for a Graph token directly does not help either: `POST /_api/SP.OAuth.Token/Acquire` with `{"resource":"https://graph.microsoft.com"}` answers **400 `10002` “Resource is not allowed.”** (measured 2026-11-20).

## Why it works

Uploading a package with `webApiPermissionRequests` only creates *pending* requests; a Global Administrator approves them. Once approved, every Graph token issued to the SharePoint client extensibility principal carries the scope. SPFx obtains that token through MSAL and keeps it in the MSAL cache in `localStorage`; the cache entry stores the granted scopes in its `target` field. So the cache answers “was it approved?” for the signed-in user, read-only.

## Check (paste into the browser console on a page where the web part has loaded)

```js
(() => {
  const out = [];
  for (const st of [localStorage, sessionStorage]) {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i);
      if (!/accesstoken/i.test(k)) continue;
      let v; try { v = JSON.parse(st.getItem(k)); } catch { continue; }
      if (!v || !/graph\.microsoft\.com/i.test(String(v.target || ''))) continue;
      out.push({
        cachedAt: v.cachedAt ? new Date(+v.cachedAt * 1000).toISOString() : '',
        // Put the scope you are checking here:
        has: /(^|\s|\/)ChatMessage\.Send(\s|$)/i.test(v.target),
        scopes: String(v.target).replace(/https:\/\/graph\.microsoft\.com\//g, '')
      });
    }
  }
  return out; // never return or log v.secret – that is the token itself
})();
```

## Reading the result

- **Scope present** → the permission is approved. A 403 has another cause. Have the user sign out and back in so the token is issued after the approval (`cachedAt` tells you how old yours is), then capture the full Graph error code and message.
- **Scope missing in a token cached after the upload** → the request is still pending (or was rejected). The Global Administrator approves it in *SharePoint admin center › Advanced › API access*.
- **No Graph entry at all** → the solution has not requested a Graph token in this browser yet. Use the feature once, then check again.

## Related

- Make the error itself say more: surface the Graph `code` and `message` next to your friendly text. A bare “403” cannot tell a missing consent from a licence or policy block.
