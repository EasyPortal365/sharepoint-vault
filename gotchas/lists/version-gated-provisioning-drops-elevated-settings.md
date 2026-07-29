---
title: Version-gated provisioning silently drops the settings only an admin could write
tags: [lists, provisioning, permissions, spfx]
applies-to: SharePoint Online (client-side provisioning that runs on page load)
last-reviewed: 2026-07-29
---

# Version-gated provisioning silently drops the settings only an admin could write

> **Bottom line.** Client-side provisioning usually runs once per schema version: bump a number, the code creates lists and columns, then stores the new version so it never runs again. Creating a *column* needs the same rights as creating a *list*, so that part either works for everybody or fails for everybody. But list **settings** — `Hidden`, `ReadSecurity`, `WriteSecurity`, a renamed `Title` — are a `PATCH` on the list itself, and that needs Manage Lists. If the first person to open the app after the upgrade is an ordinary member, the PATCH returns 403, the columns still succeed, the new version gets stored, and the setting is **never applied again**. It will look correct on your tenant and wrong on the customer's, with nothing in between to explain it.
>
> **Ve zkratce.** Klientský provisioning běží jednou za verzi schématu: zvednete číslo, kód doplní seznamy a sloupce a verzi si uloží, aby už neběžel. Sloupec smí přidat jen ten, kdo smí založit seznam — to buď projde všem, nebo nikomu. Jenže **nastavení seznamu** (`Hidden`, `ReadSecurity`, `WriteSecurity`, přejmenování) je `PATCH` na samotný seznam a ten chce Manage Lists. Když appku po upgradu otevře jako první běžný člen, PATCH skončí 403, sloupce projdou, nová verze se uloží — a nastavení se **už nikdy nedorovná**. U vás to bude v pořádku, u zákazníka ne, a nic mezi tím to nevysvětlí.

## Symptom

You ship a schema bump that, besides new columns, also changes something about the lists themselves — hides them from *Site contents*, or switches item-level read from "only their own" to "all items".

On your own tenant everything is exactly as designed. On a customer's tenant the columns are there, the version number in your status list says the migration ran, and yet the lists are still visible / still per-user. Re-running the app changes nothing: the stored version matches, so the provisioning block is skipped entirely.

The `ReadSecurity` variant is the nasty one. An admin bypasses item-level security, so *you* see a full list and *members* see an empty app. Nobody reports "the migration failed" — they report "the app shows nothing", which sends you hunting in completely the wrong place.

## Cause

Two independent design decisions combine badly:

1. **The whole block is gated on the version number.** After a successful run the new version is stored, and every later load short-circuits.
2. **Only column failures are treated as failures.** Provisioning code typically aggregates the result of "add field" calls and refuses to store the new version when any of them failed — that's what makes retries work. The settings `PATCH` is usually a fire-and-forget call whose non-OK response is logged and forgotten.

So a 403 on the settings PATCH is invisible to the retry logic. The run counts as successful, the version advances, and the one moment when that PATCH would ever have been attempted is gone.

Who triggers provisioning is not something you control: it is whoever opens the app first after deployment.

## Fix

Give elevated settings a **second attempt outside the version gate**, in a step that repeats for each user rather than once per site:

```
run provisioning (version-gated: lists + columns)

marker = `<app>-postprov-v<manifestVersion>r<stepRevision>-<webUrl>`   // localStorage, per user + web
if (!localStorage.getItem(marker)) {
    await ensureListSettings()      // and anything else needing elevated rights
    localStorage.setItem(marker, Date.now())
}
```

A member runs it, fails, and marks it done in *their* browser — but the admin has their own `localStorage`, so the step really executes the first time an admin opens the app. The separate `stepRevision` in the marker lets you re-run the step later without touching the schema version.

Inside the step, **read the current state and PATCH only the difference**:

```
GET  /_api/web/GetList('<server-rel>/Lists/<name>')?$select=Id,Hidden
     → if Hidden is already true, skip

PATCH /_api/web/lists(guid'<id>')
      Content-Type: application/json          // no __metadata, no odata=verbose
      IF-MATCH: *
      { "@odata.type": "#SP.List", "Hidden": true }
```

That keeps the step cheap and — more usefully — silent for members, who never issue the write that would 403.

Two things worth stating plainly, because they get assumed in both directions:

- **`Hidden` is cosmetic.** It removes the list from *Site contents* and from list pickers. It is not a permission boundary: REST reads, the list's own pages and direct URLs all keep working exactly as before. Anything that must not be read needs real permissions.
- **`Hidden` also hides the list from the people who maintain it.** If you hide application lists, give admins a way back in — a list of the lists with links to `<web>/Lists/<name>/AllItems.aspx` somewhere in the app's settings screen. Build that list from the same manifest the provisioning uses, so it cannot drift.

## Rule of thumb

When you touch a provisioning manifest, ask: **which of these operations needs more than read access, and what happens when it fails?** If the answer is "it gets logged and the version is stored anyway", you need the retry path above. A failure aggregator that only watches one class of operation quietly turns every other class into a no-op.
