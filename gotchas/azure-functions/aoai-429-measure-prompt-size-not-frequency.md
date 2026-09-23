---
title: "Azure OpenAI 429 on a single request is a TPM ceiling, not a busy service — measure size, not frequency"
tags: [azure-functions, azure-openai, quota, rate-limiting, diagnostics, rag]
applies-to: Any app calling Azure OpenAI chat completions through a Function App (RAG, document Q&A)
last-reviewed: 2026-09-18
---

# Azure OpenAI 429: measure prompt size, not request frequency

> **Bottom line.** HTTP 429 from Azure OpenAI reads like "the service is busy", so the instinct is to retry and wait. But if a *single* request carries a prompt larger than the deployment's tokens-per-minute (TPM) allowance, it can **never** fit the window — no amount of retrying helps, and the tell is the **latency of the rejection**: a few hundred milliseconds means the request was refused outright, not queued. Two requests down the same path — one tiny, one large — separate "busy" from "over the ceiling" in about two minutes. And raising TPM on a pay-per-token SKU costs **nothing**, because you pay for tokens consumed, not for the quota you hold.
>
> **Ve zkratce.** HTTP 429 z Azure OpenAI vypadá jako „služba je vytížená“, takže první nápad je opakovat a počkat. Když ale *jediný* požadavek nese prompt větší než minutová kvóta deploymentu (TPM), do okna se nevejde **nikdy** – opakování nepomůže a poznávacím znakem je **rychlost odmítnutí**: pár set milisekund znamená, že požadavek nestál ve frontě, ale narazil na strop. Dva dotazy tou samou cestou – jeden malý, jeden velký – odliší „vytíženo“ od „nad stropem“ za dvě minuty. A navýšení TPM u pay-per-token SKU nestojí **nic**, protože se platí za spotřebované tokeny, ne za držený limit.

Document Q&A (RAG) makes this trap easy to hit: the user's question is short, but the prompt that
reaches the model carries retrieved source material and runs into tens of thousands of tokens. A
default-sized deployment then rejects the request that matters most while trivial chat keeps working.

## Symptom

Users report the assistant failing on questions about documents, while short questions answer fine:

```
AI service is busy (quota). Please try again in a moment.
```

The app already retries 429 up to three times, honouring `Retry-After`. It still fails. Azure
Portal shows the service healthy, and the token usage for the day is a rounding error — so
"we are hammering it" is clearly wrong, yet the requests keep getting refused.

## The A/B test that settles it

Send two requests down the **same** code path, differing only in prompt size. If your API has a
diagnostic request kind that is not billed or logged as a user action, use it.

```js
const API = 'https://<your-function>.azurewebsites.net/api/chat';

async function probe(content) {
  const t0 = Date.now();
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }], maxTokens: 64 })
  });
  return { status: r.status, ms: Date.now() - t0, body: (await r.text()).slice(0, 200) };
}

// A: a handful of tokens.
console.log(await probe('Answer in one word: yes.'));
// B: the same question plus filler, sized like a real RAG prompt.
console.log(await probe('Answer in one word: yes.\n\n' + 'Neutral filler text. '.repeat(2500)));
```

A real measurement from a live deployment:

| request | prompt | result |
|---|---|---|
| `Answer in one word: yes.` | 17 tokens | **200** in 3.2 s |
| same + ~52 600 characters of filler | tens of thousands of tokens | **429 in 0.6 s** |

**Read the timing, not just the status.** The large request was refused in 609 ms — it never waited
for a window to open. The small request succeeded *immediately afterwards*, which proves the service
was healthy the whole time. Had the deployment genuinely been saturated, both would have failed.

## Cause

A model deployment's TPM allowance is a **rate ceiling applied per request as well as per minute**.
If one request's prompt exceeds it, Azure OpenAI rejects it immediately rather than queueing it.
Provisioning scripts commonly default to a small capacity — 10, meaning 10 000 TPM — which is below
what a single document-grounded prompt needs, so the feature is broken on arrival while ordinary
chat hides the problem.

## Rules

1. **On 429, measure size before frequency.** "Busy" and "over the ceiling" share one error message;
   a small/large pair plus the rejection latency tells them apart. Sub-second refusal = ceiling.
2. **TPM quota is not a cost.** On pay-per-token SKUs (`Standard`, `GlobalStandard`) you are billed
   for tokens consumed; TPM only caps throughput. Keeping it low saves nothing and breaks traffic.
   (Pre-paid reserved capacity — PTU — is the case where holding capacity does cost money.)
3. **Log the 429 response body.** Unlike other failure bodies it carries no prompt content, only
   Azure's own sentence naming the limit and the recommended delay:
   `exceeded token rate limit of your current … pricing tier. Please retry after N seconds.`
   Without it an administrator has no way to tell a saturated service from an undersized deployment.
4. **Size the deployment against one worst-case prompt, not against user count.** Take your app's
   per-message character budget, convert conservatively (Czech and other diacritic-heavy languages
   run near ~1.6 characters per token, far denser than the usual "4 characters" rule of thumb), and
   make sure a single request fits with room to spare.
5. **Check capacity on deployments that already exist — and raise it, don't just warn.** A
   provisioning script that "skips" an existing deployment leaves an undersized one in place
   forever, silently, across re-runs. Warning about it is barely better: a warning nobody acts on
   is as good as none, and on a deployment the script itself creates, capacity is part of the
   deployment rather than someone else's setting. Two safeguards make it safe: **never lower it**
   (leave equal-or-higher alone, so a re-run cannot make things worse), and **read the model and
   its version off the live deployment and send them back unchanged** — the call is an ARM PUT, so
   a missing parameter would silently rewrite which model version is deployed; if you cannot read
   them, do nothing and report. Read `sku.capacity` first:
   ```powershell
   az cognitiveservices account deployment show `
     --resource-group <rg> --name <account> --deployment-name <deployment> `
     --query 'sku.capacity' -o tsv
   ```
6. **Measure remaining regional quota before creating a deployment**, and step down to what is
   available instead of failing on `InsufficientQuota`:
   ```powershell
   az cognitiveservices usage list --location <region> -o table
   ```
7. **Background jobs share the deployment.** A scheduled enrichment/summarisation timer competes
   for the same TPM as interactive users. Either size for both, or give the batch job its own
   deployment.

## What does *not* grow with data volume

Worth knowing before someone concludes that a large tenant will be unaffordable: a retrieval-based
answer sends **retrieved excerpts**, not the corpus. If the prompt is capped by a per-message budget
and deep reading is capped by a document count, then going from a thousand documents to a million
does not enlarge a single prompt at all. What scales linearly with the corpus is **indexing-time
summarisation** (one model call per document, once) — so that is where a volume estimate belongs,
not on the per-question cost.

## See also

- [A brand-new Azure subscription blocks your first Function App deployment](fresh-subscription-blocks-your-first-deployment.md) — the *other* quota that stops a first deployment.
- [Azure OpenAI — a pinned model+version in your deploy script is a time bomb](azure-openai-pinned-model-version-is-a-time-bomb.md) — same script, neighbouring trap.
- [`Retry-After` does not survive CORS](retry-after-does-not-survive-cors.md) — why the delay your API recommends never reaches a browser client.
