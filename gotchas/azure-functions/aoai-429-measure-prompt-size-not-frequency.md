---
title: "Azure OpenAI 429 on a single request is a TPM ceiling, not a busy service — measure size, not frequency"
short-title: "Azure OpenAI 429: measure prompt size, not frequency"
summary: One request whose prompt exceeds the deployment's TPM allowance can never fit the window, so retrying is futile — a sub-second rejection means "over the ceiling", not "busy"; separate the two with a small/large request pair, and remember that TPM costs nothing on pay-per-token SKUs, so an undersized default breaks traffic without saving a cent
tags: [azure-functions, azure-openai, quota, rate-limiting, diagnostics, rag]
applies-to: Any app calling Azure OpenAI chat completions through a Function App (RAG, document Q&A)
last-reviewed: 2026-09-25
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

## The fix (no redeploy)

In the Microsoft Foundry portal (formerly Azure AI Foundry): open the Azure OpenAI resource →
**Deployments** (a resource upgraded to Foundry shows **Models + endpoints** instead) → the
deployment your app calls → **Edit** → **Tokens per Minute Rate Limit** → raise it (100K is a
sensible floor for document Q&A) → **Save and close**. Nothing in the app needs a restart — the
limit is enforced by Azure OpenAI, not by your code — but Microsoft asks you to allow up to
15 minutes for a quota change to propagate.

If the slider stops short, the subscription's quota for that model **and deployment type** in that
region is used up: take TPM from another deployment of the same model and type in that region, or
use **Request quota** on the **Quota** page. Editing a deployment needs Owner, Contributor,
Cognitive Services Contributor or Cognitive Services OpenAI Contributor on the resource; *seeing*
the remaining quota needs **Cognitive Services Usages Reader** (or Reader) on the subscription —
a resource-level assignment is not enough.

From the CLI, change only the SKU with a PATCH (`Deployments – Update`): its body carries just
`sku` (and `tags`), so the model, its version and the content filter are not part of the request.
Read the SKU name first:

```bash
az cognitiveservices account deployment show -g <rg> -n <account> --deployment-name <deployment> --query "{sku:sku.name, capacity:sku.capacity}" -o table
az rest --method patch --url "https://management.azure.com/subscriptions/<subscription-id>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>/deployments/<deployment>?api-version=2024-10-01" --body "{\"sku\": {\"name\": \"<sku>\", \"capacity\": 100}}"
```

Avoid `az cognitiveservices account deployment create` for this. It is a full PUT: a model version
you leave out gets a default one assigned (per the API reference), and the command has no parameter
for the content filter at all.

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
   per-message character budget, convert it to tokens for your language, and make sure a single
   request fits with room to spare. Measure rather than assume: with the GPT-5-family tokenizer, a
   Czech business text came out at about 3.1 characters per token (roughly 2 tokens per word;
   measured 2026-09-25 by sending the same text at two lengths and differencing `prompt_tokens`),
   denser than the ~4 characters of English. Then add the system prompt, the conversation history
   and the `max_tokens` you request — Azure counts the requested output against the window when
   the request is admitted.
5. **Check capacity on deployments that already exist — and raise it, don't just warn.** A
   provisioning script that "skips" an existing deployment leaves an undersized one in place
   forever, silently, across re-runs. Warning about it is barely better: a warning nobody acts on
   is as good as none, and on a deployment the script itself creates, capacity is part of the
   deployment rather than someone else's setting. Two safeguards make it safe: **never lower it**
   (leave equal-or-higher alone, so a re-run cannot make things worse), and **touch only the
   capacity** — raise it with the PATCH shown in *The fix*, which sends nothing but the SKU. If your
   tooling can only run the CLI's `deployment create` (a full PUT), read the model and its version
   off the live deployment and send them back unchanged, because a missing version is replaced by
   a default; that command cannot carry the content filter either, so compare
   `properties.raiPolicyName` before and after. If you cannot read these values, do nothing and
   report. Read `sku.capacity` first:
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
