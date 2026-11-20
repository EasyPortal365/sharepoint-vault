---
title: PowerPoint add-in on the web — a new slide fails with GeneralException in SlideCollection.getItem
short-title: PowerPoint web — new slide fails in SlideCollection.getItem
summary: "In PowerPoint on the web, a slide added without `index` can be deleted but not filled (GeneralException in SlideCollection.getItem); add it with `index`, check the order of the original slides, and read the count in the next batch"
tags: [office-add-ins, powerpoint, office-js]
applies-to: PowerPoint on the web (PowerPointApi 1.10 seen), Office.js task pane add-ins that add and fill slides
last-reviewed: 2026-11-20
---

# PowerPoint add-in on the web: a new slide fails in `SlideCollection.getItem`

> **Bottom line.** In PowerPoint on the web, a slide added with `slides.add({ slideMasterId, layoutId })` and no `index` lands at the end. You can delete it, but every attempt to write into it fails with `GeneralException`, and the error location is `SlideCollection.getItem`. It fails in the same run, in a new `PowerPoint.run`, through `shapes.load('items')`, and through `shapes.getItemAt(i)`. The same code works when you pass `index`, even when `index` equals the slide count, which also means the end. Also, `slides.getCount()` queued in the same batch as `add` returns the count from before the add. If you use that count as an index, you write into an existing slide.
>
> **Ve zkratce.** Snímek přidaný v PowerPointu na webu přes `slides.add` BEZ `index` jde smazat, ale každý zápis do něj skončí `GeneralException` v `SlideCollection.getItem`. Selže to v témže i v novém `PowerPoint.run`, přes `shapes.load('items')` i přes `shapes.getItemAt`. S `index` (i na konec, `index` = počet snímků) tentýž postup funguje. Počet z `getCount()` ve stejné dávce jako `add` je ještě ten starý, takže index z něj ukáže na existující snímek a přepíšeš ho.

## Symptoms

- The slide is added, but filling its placeholders fails with `GeneralException`, and `debugInfo.errorLocation` is `SlideCollection.getItem`.
- A rollback that deletes the new slide with `slides.getItem(newId)` fails with the same error, so a half-applied change stays in the deck. Deleting it with `slides.getItemAt(i).delete()` works.
- Using `getCount()` from the same batch as `add` as the new slide's index: the title and body land on the last ORIGINAL slide, and the new slide stays empty.

## What works

```ts
await PowerPoint.run(async (ctx) => {
  // originalIds: ids of the slides before the change, in order
  const target = afterIndex + 1;                // 0..originalIds.length
  ctx.presentation.slides.add({ slideMasterId, layoutId, index: target } as PowerPoint.AddSlideOptions);
  await ctx.sync();

  // Safety check in the NEXT batch: count and positions of the ORIGINAL slides.
  const expected = [...originalIds.slice(0, target), null, ...originalIds.slice(target)];
  const count = ctx.presentation.slides.getCount();
  const checks = expected.map((id, i) => {
    if (id === null) return undefined;
    const s = ctx.presentation.slides.getItemAt(i);
    s.load('id');
    return { s, id };
  });
  await ctx.sync();
  if (count.value !== expected.length || checks.some((c) => c && c.s.id !== c.id)) {
    throw new Error('New slide is not where expected – nothing written.');
  }

  // Fill by position.
  const shapes = ctx.presentation.slides.getItemAt(target).shapes;
  shapes.load('items/id,items/type');
  await ctx.sync();
  if (shapes.items[0]) shapes.items[0].textFrame.textRange.text = title;
  if (shapes.items[1]) shapes.items[1].textFrame.textRange.text = body;
  await ctx.sync();
});
// Only now read the new slide's id (e.g. for an "undo" button), in a fresh run.
```

Microsoft lists `AddSlideOptions.index` as preview only (PowerPointApi BETA). If the index is missing or out of bounds, the slide goes to the end. So plan for a host that ignores it:

- If the check above fails, check again for "new slide at the end". If that layout matches, fill the slide there.
- Then try `slides.getItemAt(end).moveTo(target)` (`Slide.moveTo`, PowerPointApi 1.8). If the move fails, tell the user that the slide stayed at the end.
- If neither layout matches, roll back.

## Also

- Office.js batches are not transactions. Wrap the whole apply in `try/catch`. On failure, remove the slides whose ids were not in the deck before, deleting them by position from the end, and restore the texts you changed. Only then report the error.
- Show `error.code` plus `error.debugInfo.errorLocation` in the pane. A bare "GeneralException" is useless to support, and the task pane console is hard to reach in Office on the web.
- After a failed apply, discard the proposal so the user cannot apply the same changes twice.

## Notes

We confirmed this on PowerPoint on the web (PowerPointApi 1.10) in November 2026. Without `index`, four variants failed: the same run, a separate run, items loaded, and items by position. With `index`, inserting after the first slide and at the end both worked, and so did undo from the pane. The automatic rollback after an error worked every time. We don't know why a slide added without `index` can't be written to. No Microsoft documentation describes it.

## Sources

- [PowerPoint.SlideCollection – getItemAt, getCount, add](https://learn.microsoft.com/javascript/api/powerpoint/powerpoint.slidecollection) – `getItemAt` is PowerPointApi 1.2.
- [PowerPoint.AddSlideOptions](https://learn.microsoft.com/javascript/api/powerpoint/powerpoint.addslideoptions) – `index` is PowerPointApi BETA (preview only).
- [PowerPoint.Slide – moveTo](https://learn.microsoft.com/javascript/api/powerpoint/powerpoint.slide) – PowerPointApi 1.8.
- [OfficeExtension.Error – debugInfo](https://learn.microsoft.com/javascript/api/office/officeextension.error) – `code` and `debugInfo.errorLocation`.
