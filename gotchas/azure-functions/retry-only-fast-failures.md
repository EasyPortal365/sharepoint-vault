---
title: "Retry only fast failures — a gateway error after 230 seconds is a timeout, not a hiccup"
tags: [azure-functions, azure-openai, retries, timeouts, cost, spfx]
applies-to: Any browser client (SPFx web part, extension) calling a Function App that in turn calls Azure OpenAI or another slow upstream
last-reviewed: 2026-09-24
---

# Retry only fast failures: a gateway error after 230 seconds is a timeout, not a hiccup

> **Bottom line.** A client that retries 502/503/504 is right to do so for the failures it was written for — a transient 502 or 503, a 429 with `Retry-After`. But the same status codes also come back when a request simply ran out of time, and retrying *those* multiplies the wait (three attempts of ~230 s each is more than ten minutes of an empty screen) and the bill (Azure OpenAI charges for the processing it performed even when the request ends in an error — and the user never sees the answer). Decide by **how long the failed attempt took**, not only by the status code: retry what failed fast, surface what failed slow. And give the server its own deadline *below* the platform limit, answering with a status your clients do not retry.
>
> **Ve zkratce.** Klient, který opakuje 502/503/504, má pravdu u selhání, pro která to bylo napsané – u chvilkové 502 nebo 503, u 429 s `Retry-After`. Tytéž kódy ale přijdou i tehdy, když požadavku prostě došel čas, a opakování *takového* selhání znásobí čekání (tři pokusy po ~230 s jsou přes deset minut prázdné obrazovky) i účet (Azure OpenAI účtuje provedené zpracování, i když požadavek skončí chybou – a uživatel odpověď stejně neuvidí). Rozhoduj podle toho, **jak dlouho neúspěšný pokus trval**, ne jen podle kódu: opakuj rychlé selhání, pomalé ukaž uživateli. A serveru dej vlastní strop *pod* limitem platformy s odpovědí, kterou klienti neopakují.

## Symptom

Large requests — long documents, many retrieved sources — can fail only after *several minutes*,
with a generic AI-service error, while short requests work fine. Reading both ends of the call shows
why: up to three attempts, each allowed to run into the platform's ~230-second limit.

## Cause: two reasonable rules that multiply each other

1. **The client retries 429/502/503/504.** Sensible: a single transient failure should not reach
   the user. (After idling, a Consumption-plan app also starts cold — Microsoft says cold starts are
   expected on that plan and add latency to the next request.)
2. **The server calls the upstream model without a deadline.** For a long generation the platform's
   own HTTP limit hits first — 230 seconds for HTTP-triggered functions (the Azure Load Balancer idle
   timeout; App Service documents 240 s on Linux). Microsoft documents that the load balancer then
   "will time out and return an HTTP 502 error" — which rule 1 dutifully retries.

The upstream call is not cancelled when the browser gets its error: Microsoft documents that the
function "will continue running but will be unable to return an HTTP response". A function without
its own deadline keeps waiting; whenever the model finishes in that time, the call is billed like any
other and the answer goes nowhere — once per attempt. (Microsoft ties charges to whether processing
occurred, not to the status code; what is billed when the caller disconnects mid-generation is not
documented.)

## Fix

**Client — retry only failures that came back quickly:**

```ts
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = [429, 502, 503, 504];
/** Our cut-off: a failure that took this long is treated as a timeout, not a transient hiccup. */
const RETRY_MAX_ELAPSED_MS = 30000;

function worthRetrying(elapsedMs: number, attempt: number): boolean {
  return attempt < MAX_RETRIES - 1 && elapsedMs < RETRY_MAX_ELAPSED_MS;
}

for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    if (worthRetrying(Date.now() - startedAt, attempt)) { await delay(2000 * (attempt + 1)); continue; }
    throw e;
  }
  if (RETRYABLE_STATUS.indexOf(response.status) !== -1 && worthRetrying(Date.now() - startedAt, attempt)) {
    await delay(retryAfterOrBackoff(response, attempt));
    continue;
  }
  // …handle the response or throw a readable error
}
```

**Server — own deadline below the platform limit, counted from the start of the handler, and a
non-retryable answer after it:**

```ts
const handlerStartedAt = Date.now();                      // first line of the handler
// …authentication, validation, prompt assembly…
const controller = new AbortController();
const remaining = Math.max(1, 200_000 - (Date.now() - handlerStartedAt)); // below ~230 s in total
const timer = setTimeout(() => controller.abort(), remaining);
try {
  const upstream = await fetch(openAiUrl, { ...init, signal: controller.signal });
  // …
} catch (e) {
  if (controller.signal.aborted) {
    // 500 on purpose: clients retry 502/504, and a retry here repeats the same slow, billed call.
    // CORS headers too — without them the browser cannot read the message (see "Related").
    return { status: 500, headers: corsHeaders, jsonBody: { error: 'The AI service did not finish in time. Try a narrower request.' } };
  }
  throw e;
} finally {
  clearTimeout(timer);
}
```

**Downstream steps** (document extraction, fetching a web page) get their own deadlines *below the
client's* timeout, so the server can still say why it gave up before the browser aborts the request.

## How to verify

- Unit-test the decision function: fast failure → retry, failure at or above the threshold → no
  retry, last attempt → never.
- Integration test with a stubbed `fetch` that "takes" 40 seconds (advance a mocked clock) and returns
  a gateway error: the client must call `fetch` exactly **once**.
- Sabotage the guard (drop the elapsed-time condition) and confirm the test fails.

## Sources

- Microsoft Learn — [HTTP trigger: limits](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger#limits) (230 s, Azure Load Balancer returns HTTP 502, the function keeps running).
- Microsoft Learn — [Function app timeout duration](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale#timeout) (230 s regardless of the function timeout setting).
- Microsoft Learn — [Event-driven scaling: cold start](https://learn.microsoft.com/en-us/azure/azure-functions/event-driven-scaling#cold-start) (cold starts are expected on the Consumption plan).
- Microsoft Learn — [Azure OpenAI FAQ](https://learn.microsoft.com/en-us/azure/foundry-classic/openai/faq) (processing is charged even when the status code is not 200).

## Related

- [Azure OpenAI 429 on a single request is a TPM ceiling](aoai-429-measure-prompt-size-not-frequency.md) — when the *fast* rejection is not transient either.
- [Retry-After does not survive CORS](retry-after-does-not-survive-cors.md) — the header your backoff reads may never reach the browser.
