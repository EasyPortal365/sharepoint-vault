---
title: ListViewCommandSet button never appears — raiseOnChange() does not re-run onListViewUpdated
tags: [spfx, extensions, list-view-command-set, app-catalog]
applies-to: SharePoint Online (SPFx 1.x extensions)
last-reviewed: 2026-08-11
---

# Your command set button never appears — two independent reasons

> **Bottom line.** A `ListViewCommandSet` button that stays invisible is usually one of two things: the extension was never *registered* on the site (uploading a new `.sppkg` to the app catalog does not register anything — only installing or updating the app on that site does), or your visibility logic lives solely inside `onListViewUpdated` and depends on async config — `raiseOnChange()` re-reads `command.visible`, it does **not** call your callback again.
>
> **Ve zkratce.** Neviditelné tlačítko `ListViewCommandSet` má obvykle jednu ze dvou příčin: rozšíření není na webu vůbec *zaregistrované* (nahrání nového `.sppkg` do katalogu aplikací nic nezaregistruje – propíše se to až instalací nebo aktualizací aplikace na tom webu), nebo se viditelnost počítá jen v `onListViewUpdated` a závisí na asynchronní konfiguraci – `raiseOnChange()` jen znovu PŘEČTE `command.visible`, tvůj callback nezavolá.

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
