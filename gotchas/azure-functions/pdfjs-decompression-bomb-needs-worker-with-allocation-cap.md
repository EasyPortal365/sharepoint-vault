---
title: A PDF decompression bomb stalls pdf.js in Node — worker_threads resourceLimits alone won't stop it
short-title: PDF bomb in pdf.js needs a worker with an allocation cap
summary: "pdf.js decodes a page's content stream synchronously into one doubling buffer, so a 100 kB PDF freezes the event loop and a per-page deadline never fires; run it in worker_threads with terminate() on a time budget — and cap single allocations inside the worker, because decoded streams live outside the JS heap that resourceLimits watches, and RSS growth lies after a previous job"
tags: [azure-functions, nodejs, pdf, security, dos]
applies-to: Node.js services and Azure Functions reading untrusted PDFs with pdfjs-dist 3.x (text or image extraction)
last-reviewed: 2026-11-17
---

# A PDF decompression bomb stalls pdf.js in Node

> **Bottom line.** pdf.js decodes a page's content stream synchronously, so one crafted page freezes the event loop and a deadline you check between pages never fires. Measured with pdfjs-dist 3.11: a 100 kB PDF inflates to 100 MB with no event-loop tick for 4.4 s, and a 51 kB page of tiny operators takes 33 s and 410 MB. A 10 MB upload takes the whole instance down. Move PDF parsing into `worker_threads` and `terminate()` it on a time budget. Also cap **single allocations** inside the worker, because `resourceLimits` only sees the JS heap and decoded streams are ArrayBuffers outside it.
>
> **Ve zkratce.** pdf.js dekóduje obsahový stream stránky synchronně, takže jediná podvržená stránka zastaví event loop a deadline kontrolovaný mezi stránkami nezabere. Naměřeno s pdfjs-dist 3.11: 100 kB PDF se nafoukne na 100 MB a event loop 4,4 s netikne; 51 kB stránka s drobnými operátory trvá 33 s a zabere 410 MB. 10 MB upload shodí celou instanci. Čtení PDF přesuňte do `worker_threads` s `terminate()` po rozpočtu času. Ve workeru navíc omezte velikost **jedné alokace**: `resourceLimits` vidí jen JS heap a dekódované streamy jsou ArrayBuffery mimo něj.

## Symptom

A Function that extracts text or images from user-supplied PDFs:

- stops answering *all* requests for several seconds, or the process dies with out-of-memory,
- ignores its own deadline (`if (Date.now() > deadline) break;` between pages),
- in a scheduled job, it fails on the same document every run. The process crash means the document is never marked as broken.

The input is tiny: a FlateDecode stream of spaces (1:1000 ratio), or a page with millions of `BT … Tj ET` operators.

## Cause

`page.getTextContent()` / `getOperatorList()` decode the whole content stream synchronously on the calling thread. The decoder grows one buffer by doubling. Nothing yields to the event loop until the page is done, so no timer, deadline or `AbortController` can interrupt it from the outside.

## What does not work on its own

| Attempt | Why it fails |
|---|---|
| Deadline checked between pages | One page is the bomb. |
| `worker_threads` + `resourceLimits.maxOldGenerationSizeMb` | It catches the operator flood (`ERR_WORKER_OUT_OF_MEMORY`), but the inflated stream is an ArrayBuffer outside the V8 heap. The worker happily allocates gigabytes. |
| Watching `process.memoryUsage().rss` growth since the job started | The process keeps memory it freed after the previous job, and the next worker reuses it without RSS growing. In a test, a 400 MB bomb ran to completion in 27 s under a 768 MB RSS limit. Use RSS only as a backup. |

## Fix

1. **Parse in a worker, kill on time.** Start one `Worker` per job. Hard-`terminate()` it at `deadline + grace` when the caller has a deadline, otherwise at a job ceiling. Limit concurrency (e.g. 2) with a small queue.
2. **Cap single allocations inside the worker**, before pdf.js is loaded:

   ```js
   // worker entry — runs before require('pdfjs-dist')
   const { parentPort, workerData } = require('node:worker_threads');
   const max = workerData.maxAllocBytes;
   let reported = false;
   const hit = (n) => {
     if (!reported) { reported = true; parentPort.postMessage({ type: 'limit', bytes: n }); }
     throw new RangeError('allocation over limit');
   };
   for (const name of ['ArrayBuffer', 'Uint8Array', 'Uint8ClampedArray', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array']) {
     const Orig = globalThis[name];
     globalThis[name] = new Proxy(Orig, {
       construct(target, args, newTarget) {
         const a = args[0];
         const bytes = typeof a === 'number' ? a * (target.BYTES_PER_ELEMENT || 1) : 0;
         if (bytes > max) hit(bytes);
         return Reflect.construct(target, args, newTarget);
       }
     });
   }
   ```

   A Proxy keeps `instanceof` and static members working. Node's `Buffer` holds its own references, so it stays unaffected. Because the decoder doubles its buffer, the bomb stops at the first step over the cap. Post the hit to the main thread right away: pdf.js may swallow the page error and carry on.
3. **Stream pages back** (`postMessage` per page). A deadline kill can then return an honest partial result ("stopped at page N") instead of nothing.
4. **Map the outcome for callers**: HTTP `422` ("PDF too complex — split it or convert it") instead of 500. In batch jobs, a *permanent* failure marker so the job doesn't retry every run. For image extraction, fail open (no images, a warning).
5. **Cost:** each worker loads pdf.js again. We measured about 0.7 s extra per read. That's fine for uploads and background jobs; pool workers if you need lower latency.

## How to test it

- Build the bomb in the test: `deflateSync(Buffer.alloc(400 * 2 ** 20, 0x20))` as the page's `/Contents` with `/Filter /FlateDecode`. That's a few hundred kB on disk.
- Assert the **longest main-thread pause** (an interval timer recording the max gap), not the tick count. Tick counts swing with machine load.
- Keep a **counter-example** with the worker switched off: the same page must block the main thread for over a second. Otherwise the test can't tell a fix from a bomb that's too small.
- Size the slow-page input with an order-of-magnitude margin. A page that took 8 s locally was read within about a second (worker start included) on a CI runner, and the deadline test failed with `complete`.
