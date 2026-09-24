---
title: "Retry only fast failures — a 504 after 230 seconds is a timeout, not a hiccup"
tags: [azure-functions, azure-openai, retries, timeouts, cost, spfx]
applies-to: Any browser client (SPFx web part, extension) calling a Function App that in turn calls Azure OpenAI or another slow upstream
last-reviewed: 2026-09-24
---

# Retry only fast failures: a 504 after 230 seconds is a timeout, not a hiccup

> **Bottom line.** A client that retries 502/503/504 is right to do so for the failures it was written for — a Function App waking from a cold start, a transient 503. But the same status codes also come back when the request simply ran out of time, and retrying *those* multiplies the wait (three attempts of ~230 s each is more than ten minutes of an empty screen) and the bill (the upstream model finished and was paid for; nobody read the answer). Decide by **how long the failed attempt took**, not only by the status code: retry what failed fast, surface what failed slow. And give the server its own deadline *below* the platform limit, answering with a status your clients do not retry.
>
> **Ve zkratce.** Klient, který opakuje 502/503/504, má pravdu u selhání, pro která to bylo napsané – studený start Function App, chvilková 503. Tytéž kódy ale přijdou i tehdy, když požadavku prostě došel čas, a opakování *takového* selhání znásobí čekání (tři pokusy po ~230 s jsou přes deset minut prázdné obrazovky) i účet (model upstream odpověď dopočítal a zaúčtoval, jen ji nikdo nepřečetl). Rozhoduj podle toho, **jak dlouho neúspěšný pokus trval**, ne jen podle kódu: opakuj rychlé selhání, pomalé ukaž uživateli. A serveru dej vlastní strop *pod* limitem platformy s odpovědí, kterou klienti neopakují.

## Symptom

Large requests — long documents, many retrieved sources — fail after *several minutes* with a
generic "the AI service did not respond" message. The client log shows three attempts, each lasting
well over 200 seconds. Short requests work fine.

## Cause: two reasonable rules that multiply each other

1. **The client retries 429/502/503/504.** Sensible: a Function App on the Consumption plan often
   fails the first request after idling, and a single hiccup should not reach the user.
2. **The server calls the upstream model without a deadline.** For a long generation the platform's
   own HTTP limit (about 230 seconds for Azure Functions/App Service front ends) cuts the connection
   first and the browser receives **504** — which rule 1 dutifully retries.

The upstream call is not cancelled when the client goes away. The model finishes, the tokens are
billed, and the result is dropped on the floor — three times.

## Fix

**Client — retry only failures that came back quickly:**

```ts
const MAX_RETRIES = 3;
const RETRYABLE_STATUS = [429, 502, 503, 504];
/** A failure after this long is a timeout, not a cold start. */
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

**Server — own deadline below the platform limit, and a non-retryable answer after it:**

```ts
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 200_000); // below ~230 s
try {
  const upstream = await fetch(openAiUrl, { ...init, signal: controller.signal });
  // …
} catch (e) {
  if ((e as Error).name === 'AbortError') {
    // 500 on purpose: clients retry 504, and a retry here repeats the same slow, billed call.
    return { status: 500, jsonBody: { error: 'The AI service did not finish in time. Try a narrower request.' } };
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
  504: the client must call `fetch` exactly **once**.
- Sabotage the guard (drop the elapsed-time condition) and confirm the test fails.

## Related

- [Azure OpenAI 429 on a single request is a TPM ceiling](aoai-429-measure-prompt-size-not-frequency.md) — when the *fast* rejection is not transient either.
- [Retry-After does not survive CORS](retry-after-does-not-survive-cors.md) — the header your backoff reads may never reach the browser.
