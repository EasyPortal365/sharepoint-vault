---
title: "Reindex a library from code works even on a no-script site — the root folder's property bag is writable, the web's is not"
short-title: Reindex a library from code under NoScript
summary: "Bumping `vti_searchversion` on the library's RootFolder property bag via CSOM succeeds on sites with custom scripts disabled (unlike the web property bag); find the library from any item URL with `GetWebUrlFromPageUrl` + `web/GetList`"
tags: [rest-api, csom, search, reindex, noscript, property-bag, crawl-log]
applies-to: SharePoint Online (modern sites with custom scripts disabled), delegated calls from SPFx or the browser
last-reviewed: 2026-10-27
---

# Reindex a library from code works even on a no-script site — the root folder's property bag is writable, the web's is not

> **Bottom line.** The "Reindex document library" button in Advanced settings just increments `vti_searchversion` in the property bag of the library's **root folder**. Writing that value through CSOM (`RootFolder.Properties.SetFieldValue` + `RootFolder.Update()`) succeeds on modern sites with custom scripts disabled — unlike the same write to the **web** property bag, which fails with access denied there. To get from a crawl-log or search URL to the library, ask `SP.Web.GetWebUrlFromPageUrl` for the web and call `web/GetList` with the item's decoded path: it accepts any URL inside the list.
>
> **Ve zkratce.** Tlačítko „Znovu zaindexovat knihovnu“ jen zvedne `vti_searchversion` v property bagu **kořenové složky** knihovny. Zápis přes CSOM (`RootFolder.Properties.SetFieldValue` + `RootFolder.Update()`) projde i na webu s vypnutými vlastními skripty – na rozdíl od property bagu **webu**, kde týž zápis končí odepřeným přístupem. Knihovnu k adrese z crawl logu nebo hledání najdeš tak, že web zjistíš přes `SP.Web.GetWebUrlFromPageUrl` a zavoláš `web/GetList` s dekódovanou cestou položky – přijme jakoukoli adresu uvnitř seznamu.

## Symptom

An admin tool lists slow or failed crawl entries and you want a "reindex this library" action next to them. Two things look like blockers:

- the crawl log row carries only a URL (its `AccessData` GUID belongs to the item, not to the list), so there is no list ID to build `advsetng.aspx?List={id}` from;
- the well-known observation that property-bag writes are blocked on no-script sites (true for `web.AllProperties`) suggests the reindex flag cannot be set from code either.

## Cause

The no-script restriction is about the **web** property bag. The reindex flag lives on a different object — the list's root folder — and that write is allowed for anyone who can manage the list. Measured on a modern site with custom scripts disabled, as a site admin: the CSOM call returned `ErrorInfo: null` and the value was persisted.

`GetList` is more forgiving than its name suggests: it resolves the list from the root URL, a view or form page (`Forms/AllItems.aspx`, `DispForm.aspx`), a file deep in folders, or a crawl-log item URL such as `…/Lists/Tasks/1_.000`. It fails (404) only when the path has a query string, is still URL-encoded, or is sent to a parent web.

## Fix

1. Strip `?…` and `#…`, decode the path.
2. `POST {anyWeb}/_api/SP.Web.GetWebUrlFromPageUrl` with body `{ "pageFullUrl": "<absolute url>" }` → the web the item lives in.
3. `GET {web}/_api/web/GetList(@a)?@a='<server-relative path>'&$select=Id,Title,ItemCount` → the library.
4. Read the current value: `GET {web}/_api/web/lists(guid'<id>')/RootFolder/Properties?$select=vti_x005f_searchversion` (missing = never reindexed, treat as 0).
5. Write `n + 1` through `{web}/_vti_bin/client.svc/ProcessQuery`:

```xml
<Request SchemaVersion="15.0.0.0" LibraryVersion="16.0.0.0" ApplicationName="MyTool"
         xmlns="http://schemas.microsoft.com/sharepoint/clientquery/2009">
  <Actions>
    <Method Name="SetFieldValue" Id="10" ObjectPathId="6">
      <Parameters>
        <Parameter Type="String">vti_searchversion</Parameter>
        <Parameter Type="Int32">5</Parameter>
      </Parameters>
    </Method>
    <Method Name="Update" Id="11" ObjectPathId="5" />
  </Actions>
  <ObjectPaths>
    <StaticProperty Id="1" TypeId="{3747adcd-a3c3-41b9-bfab-4a64dd2f1e0a}" Name="Current" />
    <Property Id="2" ParentId="1" Name="Web" />
    <Property Id="3" ParentId="2" Name="Lists" />
    <Method Id="4" ParentId="3" Name="GetById">
      <Parameters><Parameter Type="Guid">{LIST-ID}</Parameter></Parameters>
    </Method>
    <Property Id="5" ParentId="4" Name="RootFolder" />
    <Property Id="6" ParentId="5" Name="Properties" />
  </ObjectPaths>
</Request>
```

CSOM reports errors inside an HTTP 200 body — check `ErrorInfo` of the response array, not the status code.

## Notes

- The crawler picks the flag up on its next pass; SharePoint does not say when. Show "reindex requested", not "reindexed".
- A full reindex of a large library is real load on the tenant's crawl capacity. Confirm with the item count and do not offer it as a bulk action.
- If you open the settings page instead, call `window.open` synchronously inside the click and set its location after the lookup — a window opened after an `await` is dropped by popup blockers.
