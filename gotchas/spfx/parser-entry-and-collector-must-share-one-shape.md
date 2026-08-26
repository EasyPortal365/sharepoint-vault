---
title: "A parser branch whose entry condition accepts more than its collector loop consumes will freeze the tab"
tags: [spfx, react, markdown, parser, infinite-loop, out-of-memory, freeze, debugging]
applies-to: Any hand-rolled parser with per-branch collector loops (markdown renderers, tokenizers, log parsers)
last-reviewed: 2026-08-26
---

# A parser branch whose entry condition accepts more than its collector loop consumes will freeze the tab

> **Bottom line.** In a line-based parser, an entry check like `/^[-*+] /` guarding a collector loop that only consumes `/^[-*] /` is a time bomb: the first line starting with `+ ` enters the branch, the loop consumes nothing, and `continue` without advancing the index re-reads the same line forever — allocating one element per spin until the tab dies of out-of-memory. Give the entry check and the collector **one shared definition**, make the collector **contractually unable to return without advancing**, and put a global no-progress backstop on the outer loop. The bug is typically *introduced by a fix* that widens the entry condition and forgets the collector.
>
> **Ve zkratce.** V řádkovém parseru je vstupní podmínka `/^[-*+] /` nad sběrací smyčkou, která bere jen `/^[-*] /`, časovaná bomba: první řádek začínající „+ " do větve vstoupí, smyčka nic nespolkne a `continue` bez posunu indexu čte tentýž řádek donekonečna — a každá otočka alokuje element, dokud karta neumře na nedostatek paměti. Dejte vstupní podmínce a sběru **jednu sdílenou definici**, sběru **kontrakt, že se nikdy nevrátí bez posunu**, a vnější smyčce globální pojistku nepostupu. Chyba typicky **vzniká opravou**, která rozšíří vstupní podmínku a na sběr zapomene.

## Symptom

Opening a specific conversation/document freezes the browser tab within a second or two: "Page Unresponsive", then — minutes later — "Out of memory". The process RAM climbs to gigabytes.

The trap wears three disguises that send the investigation the wrong way:

- **It looks machine-specific.** Only one user reproduces it, on every machine they own — because the trigger is *their data*, which follows their account everywhere. Everyone else's data lacks the poisonous line, so "works on my machine" is true and useless.
- **It looks like a leak, but the JS heap reads small.** In-page diagnostics sample the heap on a timer; the infinite loop starves all timers, so the last recorded sample is from *before* the loop — small and flat. The gigabytes accumulate afterwards, unobserved, until V8's limit fires.
- **The trigger is mundane.** LLMs routinely emit `1)`-style numbered lists. This is not exotic input; it is Tuesday.

## Cause

The shape that entered the branch and the shape the collector consumes were **two separately-maintained regexes**:

```ts
if (/^\d+[.)] /.test(line)) {          // entry: accepts "1." AND "1)"
  const items = [];
  while (i < lines.length) {
    if (/^\d+\. /.test(lines[i])) {     // collector: accepts ONLY "1."
      items.push(...); i++;
    } else if (...) { ... }
    else break;                          // "1)" line: consumed NOTHING
  }
  elements.push(<ol>...</ol>);           // pushes every spin
  continue;                              // ← index unchanged → same line again, forever
}
```

History matters: the two regexes did not drift by accident. A *parity fix* widened the entry condition (so `1)` and `+ ` would be recognized like the document exporter recognizes them) — and nobody touched the collector two lines below. The accompanying parity test compared **source text** of the two parsers, so it went green while creating the freeze.

## Fix

Three layers, each independently sufficient to prevent the hang:

**1. One shared shape.** Export the item regex once and use it for both roles — they physically cannot drift:

```ts
export const OL_ITEM_RE = /^\d+[.)] /;

export function collectListItems(lines: string[], start: number, itemRe: RegExp) {
  const items = [];
  let i = start;
  while (i < lines.length) {
    if (itemRe.test(lines[i])) { items.push({ heading: lines[i].replace(itemRe, ''), content: [] }); i++; }
    else if (/* blank-line / continuation rules */) { i++; }
    else break;
  }
  if (i === start) i = start + 1;   // 2. no-progress CONTRACT: next > start, always
  return { items, next: i };
}
```

**2. A no-progress contract on the collector** (`next > start`, above) — and a caller that treats an empty result as "not a list": render the line as a plain paragraph, never drop it silently.

**3. A global backstop on the outer loop** — a second visit to the same index means *no branch consumed the line*; render it as a paragraph and move on. A badly rendered line is an annoyance; a frozen browser is an outage:

```ts
let stuckAt = -1;
while (i < lines.length) {
  if (i === stuckAt) { elements.push(<p key={`stuck-${i}`}>{lines[i]}</p>); i++; continue; }
  stuckAt = i;
  ...
}
```

## Test with the live sample — and test the contract, not the source text

The regression test must contain the input that actually froze production (`"1) Task name"`, `"+ bullet"`), plus an explicit contract test that simulates the *next* drift:

```ts
it('no-progress contract: next > start even for a non-matching line', () => {
  const r = collectListItems(['1) parenthesised item'], 0, /^\d+\. /);  // deliberately mismatched
  expect(r.items.length).toBe(0);
  expect(r.next).toBe(1);   // the old code stalled at 0 → caller loops forever
});
```

A parity test that greps source files for regex literals proves the shapes are *mentioned*, not that they *behave* — it stayed green while this bug shipped. Keep it if you like, but the contract test is the one that matters.
