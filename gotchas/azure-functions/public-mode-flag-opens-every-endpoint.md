---
title: "A \"public mode\" flag that disables the token check opens every endpoint in the Function App, not just the chat"
short-title: "Public-mode flag opens every endpoint, not just the chat"
summary: One Function App serves a signed-in SPFx app and an anonymous website chatbot; the website instance switches off the token check, and every other HTTP function in the same app (usage stats, storage read/write, file parsing) quietly becomes anonymous too — gate each non-public endpoint on the mode flag and enforce it with a test that scans every app.http registration
tags: [azure-functions, security, authentication, azure-openai, chatbot]
applies-to: Azure Functions (Node.js v4 model) shared between an authenticated app and an anonymous public instance
last-reviewed: 2026-11-13
---

# A "public mode" flag opens every endpoint, not just the chat

> **Bottom line.** When one Function App codebase runs both behind a signed-in SPFx app and as an anonymous chatbot on a public website, the usual trick is an app setting such as `PUBLIC_MODE=true` that switches the token check off on the public instance. That flag is read inside the shared auth helper — so it switches the check off for **every** HTTP function in the app, not just `/api/chat`. Treat the public instance as its own product: list the endpoints it really needs, return `404` from all others, and let a test fail the build when a new endpoint forgets the gate.
>
> **Ve zkratce.** Když táž Function App slouží přihlášené SPFx aplikaci i anonymnímu chatu na webu a veřejná instance vypne kontrolu tokenu příznakem typu `PUBLIC_MODE=true`, vypne ji pro **všechny** HTTP funkce v aplikaci, ne jen pro chat. Veřejná instance má mít vlastní seznam endpointů, zbytek `404` – a test, který shodí build, když nový endpoint bránu zapomene.

## Symptom

Nothing visible. The website chat works; a penetration test of the public instance then shows, with nothing but the allowed `Origin` header:

- `GET /api/usage` returns the monthly usage summary (requests, tokens per day),
- the storage-backed endpoints built for the signed-in app answer `200` for reads **and** accept writes,
- `POST /api/extractPdf` parses whatever base64 PDF you send,
- an endpoint that fetches URLs is closed only because its allowlist app setting happens to be empty.

The `Origin` check does not help: it stops a browser on a foreign page, not `curl -H "Origin: https://contoso.com"`.

## Cause

The mode flag is checked in one place — the auth helper (`authMode()` returns "off" when public) — which is exactly what you want for the chat. But every other function calls the same helper, and none of them was written with an anonymous caller in mind. A second, quieter version of the same trap sits in the request contract: the public chat accepted the full contract of the signed-in app — model selection, `max_tokens` up to the app maximum, message arrays with `image_url` parts, 50 messages of 8,000 characters, a conversation ending with an assistant turn — none of which the website widget ever sends.

## Fix

Give the public instance an explicit allowlist and gate everything else first, before origin and auth:

```ts
// publicMode.ts
export function isPublicMode(env = process.env): boolean {
  const v = String(env.PUBLIC_MODE || '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/** The public instance serves only chat and version. */
export function publicModeRejection(cors: Record<string, string>, env = process.env) {
  return isPublicMode(env) ? { status: 404, headers: cors, jsonBody: { error: 'Not found' } } : null;
}

// usage.ts, extractPdf.ts, … — first line after OPTIONS
const publicGate = publicModeRejection(corsHeaders);
if (publicGate) { return publicGate; }
```

Enforce it with a test that reads the sources, so the next endpoint cannot forget:

```js
// test/publicModeEndpoints.test.mjs
const PUBLIC_ALLOWED = new Set(['chat.ts', 'version.ts']);
for (const f of readdirSync(SRC).filter(f => f.endsWith('.ts'))) {
  const s = readFileSync(join(SRC, f), 'utf8');
  if (!/app\.http\(/.test(s) || PUBLIC_ALLOWED.has(f)) continue;
  const gate = s.indexOf('publicModeRejection(');
  const origin = s.indexOf("originRejection(request.headers.get('origin')");
  assert.ok(gate !== -1 && (origin === -1 || gate < origin), `${f}: missing public-mode gate`);
}
```

And give the public chat its **own narrow contract** derived from what the widget sends: text-only `user`/`assistant` messages, last one from the user and short, history trimmed from the back to a fixed count and character total, a small body cap (tens of kB, not the tens of MB the signed-in app needs for attachments), and client tuning parameters (`model`, `maxTokens`, `temperature`) ignored rather than clamped. Don't echo the deployment name in the response either — the widget doesn't need it.

## Notes

- Rate limits held in process memory (a `Map` per instance) reset on every restart and multiply with scale-out. On an anonymous endpoint the real spend ceiling is the Azure OpenAI deployment's TPM quota plus a budget alert on the resource — check both.
- Prompt rules ("never write code", "answer in the user's language") are probabilistic; they belong in the prompt, but the request contract and endpoint list are the deterministic part — test those.
- Related: [Server-side Origin check rejects your own smoke test](server-side-origin-check-rejects-your-own-smoke-test.md), [Rate limit counts the capability probe](rate-limit-counts-capability-probe-corporate-nat.md).
