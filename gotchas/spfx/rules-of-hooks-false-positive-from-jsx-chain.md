---
title: rules-of-hooks false-positive — a complex JSX `&&` chain flags the wrong hook
tags: [spfx, react, eslint, debugging]
applies-to: SharePoint Online (SPFx, React 17, eslint-plugin-react-hooks)
last-reviewed: 2026-07-19
---

# rules-of-hooks false-positive — a complex JSX `&&` chain flags the *wrong* hook

> **Bottom line.** When `react-hooks/rules-of-hooks` says a hook is "called conditionally" but that hook plainly isn't, stop looking at the hook. A long `&&` chain with truthiness-narrowing in your JSX return (e.g. `{a && b && x && x.length === 0 && (<…/>)}`) can break the plugin's control-flow analysis and make it blame an *earlier*, unrelated hook. Extract the condition into a named `const` and the error moves.
>
> **Ve zkratce.** Když `react-hooks/rules-of-hooks` hlásí „hook je volán podmíněně", ale ten hook zjevně podmíněný není, přestaň se dívat na hook. Dlouhý `&&` řetěz s truthy-narrowingem v JSX (`{a && b && x && x.length === 0 && (<…/>)}`) rozbije analýzu control-flow pluginu a označí *dřívější*, nesouvisející hook. Vytáhni podmínku do pojmenované `const` a chyba zmizí.

## Symptom

ESLint fails the build with:

> React Hook `React.useCallback` is called conditionally. React Hooks must be called in the exact same order in every component render. (`react-hooks/rules-of-hooks`)

…pointing at a `useCallback` that is defined at the top of the component, **before any early return**, with nothing conditional around it. `tsc --noEmit` is clean. Reverting the "obvious" suspects (a new `useState`, a new `useEffect`, a derived `const`) changes nothing. `git stash` of that one file makes the error vanish — so it *is* your edit, just not the part you keep staring at.

## Cause

The trigger is a piece of JSX you added to the render output (often **after** an early return), of the shape:

```tsx
return (
  <div>
    {/* … */}
    {user && user.role === 'agent' && scopeIds && scopeIds.length === 0 && (
      <Banner>No companies assigned.</Banner>
    )}
  </div>
);
```

That's a four-term `&&` chain where `scopeIds && scopeIds.length` does truthiness-narrowing on a `number[] | null`. `eslint-plugin-react-hooks` builds a control-flow graph of the component to verify every hook runs unconditionally. A sufficiently complex boolean expression in the returned JSX can confuse that graph, and the rule then reports **a preceding `useCallback`/`useMemo`** as conditionally called — the real culprit (the JSX chain) is never named. It is not about hook position, not about the early return, and not about the specific variable.

## Fix

Lift the condition out of the JSX into a named boolean `const`, and keep the JSX trivial:

```tsx
const agentHasNoCompanies =
  !!user && user.role === 'agent' && scopeIds !== null && scopeIds.length === 0;

return (
  <div>
    {/* … */}
    {agentHasNoCompanies && <Banner>No companies assigned.</Banner>}
  </div>
);
```

The `const` sits after the hooks and before the return; the plugin sees a single simple identifier in the JSX and stops mis-attributing.

**Debugging heuristic:** when rules-of-hooks blames a hook that is obviously unconditional, don't bisect the hooks — bisect the **render**. Look for a complex `&&`/ternary expression added in the same batch (even below an early return). `git stash <file>` confirms HEAD is clean faster than reverting hunk by hunk, and hand-reverted intermediate states mislead more than they help — reset to a clean HEAD and re-add in small blocks, running eslint after each.
