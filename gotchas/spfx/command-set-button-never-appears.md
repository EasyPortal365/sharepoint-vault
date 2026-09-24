---
title: ListViewCommandSet button never appears — raiseOnChange() does not re-run onListViewUpdated
short-title: Command set button never appears
summary: "Two independent causes: uploading a new .sppkg registers the extension on no site by itself (register it at runtime, or deploy it tenant-wide with the all-sites tick), and `raiseOnChange()` re-reads `command.visible` without re-running `onListViewUpdated`"
tags: [spfx, extensions, list-view-command-set, app-catalog]
applies-to: SharePoint Online (SPFx 1.x extensions)
last-reviewed: 2026-09-24
---

# Your command set button never appears — two independent reasons

> **Bottom line.** A `ListViewCommandSet` button that stays invisible is usually one of two things: the extension was never *registered* on the site (uploading a new `.sppkg` to the app catalog does not register anything — only installing or updating the app on that site does, or deploying the package tenant-wide), or your visibility logic lives solely inside `onListViewUpdated` and depends on async config — `raiseOnChange()` re-reads `command.visible`, it does **not** call your callback again.
>
> **Ve zkratce.** Neviditelné tlačítko `ListViewCommandSet` má obvykle jednu ze dvou příčin: rozšíření není na webu vůbec *zaregistrované* (nahrání nového `.sppkg` do katalogu aplikací nic nezaregistruje – propíše se to až instalací nebo aktualizací aplikace na tom webu, nebo nasazením balíčku pro celý tenant), nebo se viditelnost počítá jen v `onListViewUpdated` a závisí na asynchronní konfiguraci – `raiseOnChange()` jen znovu PŘEČTE `command.visible`, tvůj callback nezavolá.

## Symptom

You add a `ListViewCommandSet` to an SPFx solution that is already deployed. You build, upload the new `.sppkg`, click *Update*, open a document library, tick a file — and the button is nowhere. The bundle is reachable (you can fetch it from the CDN by hand), the manifest GUID matches, `config.json` lists the bundle, and there is nothing in the console.

## Cause 1 — the app catalog does not register anything

Client-side component registrations reach a *site* only when the app is **installed or updated on that site**. Refreshing the package in the tenant app catalog updates the bits everyone loads; it does not touch any site's registrations.

Confirm it by reading the web's custom actions directly — this is the ground truth, not the app catalog:

```
GET /_api/web/UserCustomActions?$select=Title,Location,ClientSideComponentId,RegistrationId
Accept: application/json;odata=nometadata
```

If your component's GUID is missing from that list, the extension was never wired up on this web, and no amount of cache-busting will help.

## Fix 1 — let the app register itself at runtime

If the app already provisions its own lists, have it provision its own registration too. This is idempotent, needs no per-site visits, and survives a customer installing the app on a new site:

```ts
const API = `${webUrl}/_api/web/UserCustomActions`;
const norm = (g: string) => g.replace(/[{}]/g, '').toLowerCase();

const existing = await spGet(`${API}?$select=ClientSideComponentId,Location`);
const already = (existing.value || []).some(a =>
  norm(String(a.ClientSideComponentId || '')) === norm(COMPONENT_ID));
if (already) return;

await spPost(API, {
  Title: 'Contoso Ask AI',
  Location: 'ClientSideExtension.ListViewCommandSet.CommandBar',
  ClientSideComponentId: COMPONENT_ID,
  ClientSideComponentProperties: '{}',
  RegistrationId: '101',        // 101 = document library; 100 = generic list
  RegistrationType: 1           // 1 = List (0 = None → the action is web-scoped and won't bind)
});
```

Notes that cost real debugging time:

- Compare GUIDs **without braces and case-insensitively** — SharePoint returns `{9c1f4a72-…}`, your constant almost certainly has no braces, so a naive `===` re-creates the action on every load.
- `RegistrationType: 1` is required. Without it the action is not bound to a list template and never shows in a list view.
- Creating custom actions needs `ManageWeb`. A regular user gets 403 — log it and move on; the first admin who opens the app creates it for everyone.
- Do **not** ship the package registration *and* the runtime one. You end up with two registrations of the same component and two identical buttons.

## Fix 1, tenant-wide — `ClientSideInstance.xml`

Runtime registration runs only on sites where the app is opened. To put the command set on every site of the tenant, including the ones your app never visits, deploy it as a tenant-wide extension: `skipFeatureDeployment: true`, a `ClientSideInstance.xml` listed in the feature's `elementManifests`, and *Make this solution available to all sites in the organization* ticked when the package is deployed. SharePoint then writes a row into the *Tenant Wide Extensions* list of the app catalog, and that row loads the extension everywhere. Without the tick no row is written, and a solution that relies on the row alone shows its button on no site at all — nothing warns you, so look at that list before you debug the code:

```xml
<?xml version="1.0" encoding="utf-8"?>
<Elements xmlns="http://schemas.microsoft.com/sharepoint/">
  <ClientSideComponentInstance
      Title="Contoso Tools - libraries"
      Location="ClientSideExtension.ListViewCommandSet"
      ListTemplateId="101"
      ComponentId="00000000-0000-0000-0000-000000000000"
      Properties="">
  </ClientSideComponentInstance>
  <ClientSideComponentInstance
      Title="Contoso Tools - lists"
      Location="ClientSideExtension.ListViewCommandSet"
      ListTemplateId="100"
      ComponentId="00000000-0000-0000-0000-000000000000"
      Properties="">
  </ClientSideComponentInstance>
</Elements>
```

- `Location` without a suffix puts the command in both the context menu and the command bar; `.CommandBar` or `.ContextMenu` limits it to one of them.
- One instance per list template: `101` for document libraries, `100` for generic lists.
- `Properties` must be present, even empty.
- Keep the runtime registration for tenants whose admin does not tick the box: a site-level registration works with `skipFeatureDeployment: true` too (measured on a site with the app installed: the command appeared and its bundle loaded — in the overflow, see the last note). Skip it where the package is deployed tenant-wide, or the site gets the extension twice — `GET /_api/web/tenantappcatalog/AvailableApps/GetById('<product id>')` answers `SkipDeploymentFeature: true` for a tenant-wide deployment. A failed read means "unknown", not "no".
- Writing to the *Tenant Wide Extensions* list needs rights on the app catalog; an account that can read the catalog may still get 403 there. A site-level registration needs only `ManageWeb` on that site.

## Cause 2 — `raiseOnChange()` does not re-run `onListViewUpdated`

The natural place to compute visibility is `onListViewUpdated`, because that is where the selection arrives. But visibility usually also depends on configuration you load asynchronously in `onInit`. When that config lands *after* the user made their selection, you call `raiseOnChange()` and nothing happens: the framework re-reads `command.visible`, it does not invoke your callback again. The button stays hidden until the user changes the selection — which, in a "tick a file, click the button" flow, they never do.

## Fix 2 — remember the selection, decide in one place

```ts
private _selection: ISelectedFile[] = [];

public onListViewUpdated(event: IListViewCommandSetListViewUpdatedParameters): void {
  this._selection = this._filesFrom(event.selectedRows);
  this._applyVisibility();
}

private async _loadSettings(): Promise<void> {
  // …fetch config…
  this._settings = parsed;
  this._applyVisibility();          // <- the second trigger, easy to forget
}

/** The only place that decides visibility — called from BOTH triggers. */
private _applyVisibility(): void {
  const cmd = this.tryGetCommand(COMMAND_ID);
  if (!cmd) return;
  const next = this._selection.length > 0 && this._isEnabled();
  if (cmd.visible === next) return; // don't churn the toolbar
  cmd.visible = next;
  this.raiseOnChange();
}
```

## Notes

- Only a `ListViewCommandSet` sees `event.selectedRows`. An `ApplicationCustomizer` — the floating-widget pattern — never learns which rows are ticked, so "do X with the selected files" cannot be retrofitted onto one.
- The extension shell lives in the `.sppkg`, so every change to it costs a full build → upload → update round trip at every customer. Keep the shell as dumb as you can (read input, read config, open your UI) and put everything else behind a CDN-hosted bundle you can iterate on freely.
- If your publish script has an allow-list of bundles it copies, add the new extension bundle to it **before** shipping the package. Otherwise the manifest inside the `.sppkg` points at a file that 404s on the CDN.
- The commands themselves are fixed in the manifest: you can retitle, hide or disable an existing one at runtime, never add one — see [A command set's commands are fixed in its manifest](command-set-commands-are-fixed-in-the-manifest.md).
- Before you debug either cause, open the command bar's **…** overflow. On a full bar SharePoint moves commands there, so a button missing from the first row may be registered and working; a log line from your extension in the console tells you for sure.
