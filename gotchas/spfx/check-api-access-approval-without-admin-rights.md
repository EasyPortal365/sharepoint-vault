---
title: Check whether an SPFx Graph permission is approved without admin rights
short-title: API access approval, checked without admin rights
summary: "Only admins can open API access in the SharePoint admin center, and `SP.OAuth.Token/Acquire` answers 400 “Resource is not allowed” – but the affected user can read the granted scopes of the Graph token SPFx cached in their own browser, without printing the token"
tags: [spfx, graph, permissions, troubleshooting]
applies-to: SharePoint Online, SharePoint Framework (AadHttpClient / MSGraphClient)
last-reviewed: 2026-11-20
---

# Is the permission approved? Read the scopes SPFx already received

> **Bottom line.** When an SPFx feature fails with 403, the API access page answers “was the scope approved?”, but only an administrator can open it. The affected user can answer it too, in their own browser: the Microsoft Graph token SPFx cached in `localStorage` lists the granted scopes in its `target` field. This is the user's own sign-in data. Ask them to run the check, or run it in your own tenant. Don't read the token cache of a tenant or a person who has not explicitly allowed it, even as a guest.
>
> **Ve zkratce.** Když funkce SPFx padá na 403, odpověď „bylo oprávnění schválené?“ dá stránka *Přístup k rozhraní API*, ale otevře ji jen správce. Odpověď dá i prohlížeč dotčeného uživatele: token Graphu, který SPFx uložil do `localStorage`, má v poli `target` seznam vydaných oprávnění. Jsou to přihlašovací údaje toho uživatele. Kontrolu proto spustí on sám, nebo ji uděláte ve svém tenantu. V cizím tenantu nebo cizím prohlížeči cache tokenů bez výslovného souhlasu nečtěte, ani jako host.

## Symptom

- A feature that needs a newly added delegated scope (for example `ChatMessage.Send`) returns **401/403** after the tenant uploaded the new `.sppkg`.
- The person troubleshooting is not an administrator in that tenant. The admin center refuses them (a guest sees *“External sharing is disabled for …-admin.sharepoint.com”*).
- Asking SharePoint for a Graph token directly does not help either: `POST /_api/SP.OAuth.Token/Acquire` with `{"resource":"https://graph.microsoft.com"}` answers **400 `10002` “Resource is not allowed.”** (measured 2026-11-20).

## Why it works

Uploading a package with `webApiPermissionRequests` only creates *pending* requests. For Microsoft Graph, a Global Administrator approves them on the [API access page](https://learn.microsoft.com/sharepoint/api-access), and the delegated scopes are added to the *SharePoint Online Client Extensibility Web Application Principal*. From then on, every Graph token issued to that principal carries the scope. SPFx obtains the token through MSAL and keeps it in the MSAL cache in `localStorage`. The cache entry stores the granted scopes in its `target` field, so it shows, read-only, what the signed-in user was actually granted.

## Check (the affected user pastes it into the browser console on a page where the web part has loaded)

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

The user sends back only the `has`, `cachedAt` and `scopes` values. A screenshot of the result is enough. Never ask for the token itself.

## Reading the result

- **Scope present** → the permission is approved. A 403 has another cause. Have the user sign out and back in so they get a token issued after the approval (`cachedAt` shows how old the current one is). Then capture the full Graph error code and message.
- **Scope missing from a token cached after the upload** → the request is still pending or was rejected. A Global Administrator approves it in *SharePoint admin center › Advanced › API access*.
- **No Graph entry at all** → the solution has not requested a Graph token in this browser yet. Use the feature once, then check again.

## Related

- Make the error itself say more. Surface the Graph `code` and `message` next to your friendly text, because a bare “403” cannot tell a missing consent from a licence or policy block. With that in place, the user's screenshot of the error often replaces this check.
- Revoking a permission does not invalidate tokens already issued: they stay valid until they expire ([Microsoft Learn](https://learn.microsoft.com/sharepoint/dev/spfx/use-aadhttpclient#considerations)). A token cached *before* a change can therefore mislead in either direction.
