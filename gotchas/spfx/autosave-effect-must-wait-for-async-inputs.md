---
title: "An auto-save effect computed from async-loaded inputs writes garbage on mount — gate it on a loaded flag"
tags: [spfx, react, hooks, data-integrity]
applies-to: React 17+ (SPFx web parts, but general React)
last-reviewed: 2026-07-18
---

# An auto-save effect computed from async-loaded inputs writes garbage on mount — gate it on a "loaded" flag

## Symptom

- Opening a record detail briefly flashes a wrong derived value (e.g. a score of 0) and **persists it**.
- If the user closes the panel quickly — or one of the fetches fails — the wrong value **stays saved**
  until the next visit. Most of the time a second, correct write follows the data load, which masks the bug.

## Cause

A classic React pattern combined carelessly:

```tsx
const [activities, setActivities] = useState([]);      // async-filled inputs start EMPTY
useEffect(() => { load().then(setActivities); }, []);

const result = useMemo(
  () => compute(record, { activities /* … */ }),        // computed from [] on first render
  [record, activities]);

useEffect(() => {                                       // silent auto-save of the computed value
  if (key(result) !== lastSavedKey.current) {
    lastSavedKey.current = key(result);
    svc.update(record.Id, result);                      // ← writes the "computed from nothing" value
  }
}, [result]);
```

The dedup ref (`lastSavedKey`) protects against save **loops**, not against saving **too early**: on mount
the inputs are `[]`, `compute()` yields a degraded result that differs from the stored one, and the effect
happily persists it. Per-fetch `.catch(() => [])` fallbacks make it worse — a throttled request (HTTP 429)
quietly removes one input and the auto-save writes an understated value even after "loading finished".

## Fix

1. Add a **loaded flag** set only when the inputs actually arrived, and gate the computation on it:

```tsx
const [inputsLoaded, setInputsLoaded] = useState(false);
useEffect(() => {
  let cancelled = false;
  setInputsLoaded(false);
  Promise.all([loadActivities(), loadDeals(), loadEmails()])   // STRICT: no per-fetch catch → []
    .then(res => { if (cancelled) return; /* set states */ setInputsLoaded(true); })
    .catch(() => { /* show empty UI, but DO NOT auto-save */ });
  return () => { cancelled = true; };
}, [record]);

const result = useMemo(
  () => (inputsLoaded ? compute(record, inputs) : null),
  [inputsLoaded, record, inputs]);
```

2. Read the compute inputs **strictly** — a partial failure must abort the auto-save, not degrade it.
3. If a child panel receives related data via props that start as `[]` (drill-down hosts), pass a
   `relLoaded` prop along and gate the child's auto-save on it too.

## Rule of thumb

Any *silent write* derived from *asynchronously loaded* state needs an explicit answer to
"has everything I compute from actually loaded, successfully?" — a value-dedup ref does not answer that.
