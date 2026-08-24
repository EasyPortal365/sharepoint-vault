---
title: A provisioning step gated on success runs forever for every non-admin
tags: [spfx, provisioning, permissions, localstorage, performance]
applies-to: SharePoint Online (SPFx client-side provisioning)
last-reviewed: 2026-08-24
---

# A setup step that writes its "done" marker only on success runs forever — for everyone who cannot run it

> **Bottom line.** If a startup step needs `ManageLists` (or `ManagePermissions`) and you only record it as done when it fully succeeded, every ordinary member fails it, records nothing, and pays the whole batch of calls again on the *next* page load — forever. The marker needs two states, not one: *done* (permanent) and *tried and failed* (short-lived).
>
> **Ve zkratce.** Když startovní krok potřebuje `ManageLists` (nebo `ManagePermissions`) a značku „hotovo" zapíšeš jen po úplném úspěchu, běžnému členovi selže vždycky, nic si nezapíše a celou dávku volání zaplatí znovu při příštím načtení stránky — napořád. Značka potřebuje dva stavy, ne jeden: *hotovo* (trvale) a *zkoušeno a nepovedlo se* (krátkodobě).

## Symptom

The app feels slow to start, but only for some people. An administrator opens it and it is fine; a regular member waits noticeably longer, every single time. The network tab shows dozens of sequential REST calls before the first render — reading list ids, default views, role assignments — and many of them return **403**. Reload the page and the exact same batch runs again. It never converges.

## Cause

The step is guarded by a `localStorage` marker, and the marker is written only when everything worked:

```ts
const marker = `myapp-listviews-v${manifest.version}-${webUrl}`;
if (localStorage.getItem(marker)) return;

const res = await reconcileDefaultViews(ctx, lists);
if (!res.settled) return;                 // ← member always lands here
localStorage.setItem(marker, '1');
```

`settled` means "nothing failed". Writing a default view calls `removeallviewfields` / `addviewfield`, which requires `ManageLists`. On a modern team site, members hold **Edit**, which does include `ManageLists` — but Read-only visitors, or members on a site where an owner tightened permissions, do not. For them `settled` is *never* true, so the marker is never written.

The result is not a slow first load. It is a slow **every** load, for the rest of that person's life with the app, and it sits on the critical path before the first paint.

The same shape hides in any "ensure groups", "ensure indexes", "harden list permissions" step. It is easy to miss in review because the code looks careful — it deliberately avoids recording success it did not achieve.

## Fix — give the marker two states

Distinguish *"I have not tried yet"* from *"this will never work for me"*:

```ts
const RETRY_TTL_MS = 6 * 60 * 60 * 1000;

function settledRecently(marker: string): boolean {
  try {
    const raw = localStorage.getItem(marker);
    if (!raw) return false;
    if (raw.indexOf('f:') !== 0) return true;               // done, permanently
    const at = parseInt(raw.replace('f:', ''), 10);
    return !isNaN(at) && (Date.now() - at) < RETRY_TTL_MS;  // failed, but recently
  } catch (e) { return false; }                             // private mode → just try
}

function writeGate(marker: string, ok: boolean): void {
  try { localStorage.setItem(marker, ok ? '1' : 'f:' + String(Date.now())); } catch (e) { /* quota */ }
}
```

Then the step becomes `if (settledRecently(marker)) return;` … `writeGate(marker, res.settled);`.

A member now pays the attempt at most once per window instead of on every load. An administrator whose attempt failed *transiently* (429, a blip) still retries once the window expires, so the site does get fixed — just not by hammering it.

**Choose the window by what the step protects.** A security reconciliation deserves a short one (an hour) so a real administrator dorovná it during the same working session; a pure sanity check can sit at 24 hours. Keep the schema/manifest version inside the key, so a genuine schema change forces an immediate retry.

## Two related traps in the same code

**Failing the write must lower the flag.** A frequent variant sets the flag only from the *read* and lets a failed `MERGE` pass silently:

```ts
if (!g.ok) { allOk = false; continue; }   // read failed → retry later
// ...
if (!resp.ok) console.warn(...);          // ← write failed, flag still true
```

That is the opposite bug: the marker gets written even though nothing was fixed, so the step never runs again — not even for an administrator who later gains the rights.

**Version in the key means keys accumulate.** `myapp-step-v5-<web>`, then `-v6-`, then `-v7-`… nothing removes the old ones. The origin's ~5 MB `localStorage` quota is shared with SharePoint itself, and exceeding it fails silently (every write is inside a `try/catch`), taking unrelated cached state with it. When you write a new marker, sweep keys with the same prefix and a different version.

## How to check your own code

Grep for the shape rather than the wording:

```
if (!res.settled) return
if (allOk) { localStorage.setItem
if (allFound) { localStorage.setItem
```

For each hit ask: *does this step need a permission an ordinary user lacks?* If yes, it is running on every page load for most of your users. Check the shared package too, not just the app — a startup helper reused by several apps multiplies the same defect across all of them.
