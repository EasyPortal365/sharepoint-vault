---
title: Minified React error #310 (and friends) — the SPFx debugging cheatsheet
tags: [spfx, react, debugging]
applies-to: SharePoint Online (SPFx, React 17)
last-reviewed: 2026-07-15
---

# Minified React error #310 (and friends) — the SPFx debugging cheatsheet

## Symptom

A web part renders blank, or a click does nothing. The console says only:

> Uncaught Error: Minified React error #310; visit https://reactjs.org/docs/error-decoder.html?invariant=310 for the full message…

No component name, no readable message — SPFx bundles the production build of React, so all errors arrive as numbers.

## Cause

Production React replaces error messages with codes to save bytes. The decoder URL gives you the generic text, but not *why it happens in SPFx web parts* — that mapping you learn the hard way. Here it is.

## Fix — decode by number

| Code | Official message (short) | What it almost always means in an SPFx web part |
|---|---|---|
| **#310** | Rendered *more* hooks than during the previous render | A hook placed **after an early return** or inside a condition — a render that previously bailed out now reaches extra hooks |
| **#300** | Rendered *fewer* hooks than expected — may be caused by an accidental early return | Same bug, opposite direction: this render bailed out **before** hooks that ran last time |
| **#321** | Invalid hook call | Hook called outside a function component (helper function, class, event handler defined outside), or two copies of React in the bundle |
| **#31** | Objects are not valid as a React child | You rendered a raw object — classic SharePoint case: an **SP URL field**, which REST returns as `{ Url, Description }`, dropped straight into JSX |
| **#185** | Maximum update depth exceeded | `setState` loop — state set unconditionally in render or in a `useEffect` without (or with self-triggering) dependencies |

The pattern behind #310/#300 in one picture:

```tsx
// ❌ a hook after a conditional return — #310 or #300 depending on which path ran first
if (!props.items) { return <Spinner />; }
const [selected, setSelected] = React.useState<string>();

// ✅ all hooks first, early returns after
const [selected, setSelected] = React.useState<string>();
if (!props.items) { return <Spinner />; }
```

## Notes

- Prevention beats decoding: enable `eslint-plugin-react-hooks` with `"react-hooks/rules-of-hooks": "error"` — it catches every #310/#300/#321-by-condition statically, at build time.
- Error numbers are stable across React versions (the mapping is append-only), so this table won't rot with the React 17 that SPFx ships.
- For anything not listed, paste the number into the decoder: `https://react.dev/errors/<code>`.
