---
title: "A global kill-switch must not block the operation that fixes it"
tags: [spfx, architecture, licensing, operations]
applies-to: SharePoint Framework (any SPFx app with a global lock)
last-reviewed: 2026-08-05
---

# A global kill-switch must not block the operation that fixes it

> **Bottom line.** If your app-wide lock — expired licence, suspended tenant, read-only, maintenance mode — also guards the switch that would let an administrator update or repair the app, you have built a deadlock whose only exit is deleting a key from `localStorage` in the browser console.
>
> **Ve zkratce.** Když tvůj celoaplikační zámek – vypršená licence, pozastavený tenant, read-only, režim údržby – hlídá i přepínač, kterým by správce aplikaci aktualizoval nebo opravil, postavil jsi deadlock, z něhož vede jediná cesta ven: smazat klíč v `localStorage` přes konzoli prohlížeče.

## Symptom

A freshly deployed tenant has no active entitlement yet. The running build has a bug that a newer build already fixes, so the administrator opens Settings and tries to switch the app to that newer version. It refuses:

```text
The version change could not be saved. The licence is not active.
```

Every documented route out of the problem goes through the app, and every one of them is behind the same lock. The fix that exists, is deployed, and is one click away cannot be applied. What actually resolved it was opening DevTools and deleting the loader's `localStorage` key by hand — which is not a procedure you can put in a customer-facing runbook.

## Cause

The lock started life as one guard on data writes, and then got applied by reflex to *every* write, because "a write is a write":

```typescript
// The reflex that causes it
public async setActiveVersion(version: string): Promise<void> {
  this.assertWritable();          // <- throws when the entitlement is inactive
  await this.saveSetting('activeVersion', version);
}
```

The mistake is treating **infrastructure operations** as business writes. Pinning a version, re-checking the entitlement, reading configuration and running diagnostics are not the customer's data — they are the controls you need precisely *when* the app is in a bad state. Guarding them means the lock defends itself against being lifted.

The same shape appears with any global switch: `suspended`, `maintenance`, `readOnly`, a feature-flag kill-switch, a hard quota block.

## Fix

Put the lock on business data only, and enumerate the exceptions explicitly rather than relying on where the call happens to sit:

```typescript
// Operations that must stay reachable while the app is locked.
const ALWAYS_ALLOWED = [
  'setActiveVersion',   // apply the build that contains the fix
  'revalidateLicence',  // "check again" after the entitlement is issued
  'readConfiguration',  // settings must remain visible
  'runDiagnostics'      // the admin has to be able to see what is wrong
];

public async saveBusinessData(payload: Item): Promise<void> {
  this.assertWritable();        // business writes: locked
  await this.write(payload);
}

public async setActiveVersion(version: string): Promise<void> {
  // Infrastructure: deliberately NOT behind assertWritable, see ALWAYS_ALLOWED.
  await this.saveSetting('activeVersion', version);
}
```

The design test, applied when you add the lock rather than when a customer hits it:

> **If this switch fired right now, could an administrator still repair or update the app through the UI?**

If the answer is no, the lock is too wide. Run the same question for each state you can enter: expired, suspended, over quota, maintenance.

## Notes

- **Read paths deserve the same scrutiny.** Locking *writes* but leaving Settings readable is what makes the recovery discoverable; a lock that also blanks the configuration screen leaves the admin with no information to act on.
- **A recovery path that needs DevTools does not exist.** If the only way out is a console command, the state is unrecoverable for the person who actually administers the tenant. Treat "we told them to clear `localStorage`" as evidence of a design bug, not as a workaround.
- Keep the exception list small and named. "Everything under `/settings`" drifts — the next feature added there inherits an exemption nobody intended.
- The failure is most likely on **new deployments**, where the entitlement legitimately does not exist yet, and that is exactly when the app is most likely to need its first update. Test the unlicensed path before shipping, not just the licensed one.
- Related, on the same theme of a safety mechanism producing the outcome it was meant to prevent: [Don't cache a throttled permission probe](../rest-api/dont-cache-a-throttled-permission-probe.md) — a failed probe resolves to the lowest role and locks the user out for the whole cache TTL.
