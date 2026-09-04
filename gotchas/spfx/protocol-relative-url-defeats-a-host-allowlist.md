---
title: A protocol-relative URL walks straight through your host allowlist
tags: [spfx, security, rest-api, validation]
applies-to: SharePoint Online
last-reviewed: 2026-09-04
---

# `//evil.example/Lists/X` is not a relative URL

> **Bottom line.** If your host check is `url.match(/^https?:\/\//)` and you treat "no match" as *relative, therefore my own site*, then a protocol-relative address defeats it. The browser will happily complete `//evil.example/...` with the current page's scheme and send the request — with credentials — to a host you never allowed.
>
> **Ve zkratce.** Když se host vytahuje jen z `^https?://` a „nenašel jsem host" se čte jako „relativní, tedy vlastní web", protokolově relativní adresa kontrolu obejde. Prohlížeč si schéma doplní ze stránky a požadavek pošle na cizí server.

## Symptom

Nothing looks wrong. The allowlist is there, it has tests, and every URL you tried in review was rejected or accepted correctly. Then someone stores a list address beginning with two slashes — in a settings list, an admin form, anything an operator can type — and your app fetches from a foreign origin without a single warning.

It is quiet in the worst way: the request succeeds, the response parses, and whatever came back is now content your app trusts.

## Cause

Two helpers that look independent share one flawed assumption.

```ts
// The host extractor: only absolute http(s) URLs have a host.
function hostOfListUrl(url: string): string {
  const m = /^https?:\/\/([^/]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';          // ← '' for '//evil.example/Lists/X'
}

// The gate: empty host means "relative", and relative means "our own web".
function isListHostAllowed(url: string, allowed: string[]): boolean {
  const host = hostOfListUrl(url);
  return host === '' || allowed.indexOf(host) !== -1;   // ← lets it through
}
```

`//evil.example/Lists/X` matches neither branch of the regex, so the host comes back empty, and the gate reads that as *relative*. The second helper then builds a request base from the same string and hands the browser something it knows exactly what to do with: a **protocol-relative URL**, resolved against the page's scheme. On an HTTPS page that is `https://evil.example/Lists/X`.

The trap generalises. Anywhere a validator answers "I could not find a host" and a caller reads that as "there is no foreign host", the two disagree about what an empty string means.

## What to do

**Make the scheme optional in the parser, not in the policy.**

```ts
function hostOfListUrl(url: string): string {
  // Accept an optional scheme, but ALWAYS recognise a leading '//' as a host.
  const m = /^(?:https?:)?\/\/([^/]+)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}
```

Now `//evil.example/Lists/X` yields `evil.example`, the allowlist rejects it, and the operator sees the same "points outside this site" message as for any other external address.

- **Decide what an empty result means, once.** If empty is going to mean "same origin", then every shape that carries a host must be parsed as carrying a host. The alternative — refuse anything that is not an explicit absolute URL on an allowed host — is stricter and easier to defend.
- **Do not resolve the URL with `new URL(input, location.href)` and call it done.** That normalises the address, but `new URL('//evil.example/x', location.href).host` is `evil.example`, so you still have to compare the host against the allowlist. Normalising is not validating.
- **Test the shapes, not the examples.** A useful corpus is `https://ok/…`, `http://ok/…`, `/Lists/X`, `Lists/X`, `//evil/…`, `https:/evil/…`, `\\\\evil\\…`, `HTTPS://OK/…` and an empty string. The two-slash case is the one that gets forgotten, because it looks like a typo rather than an address.
- **Regression-test with a counterexample.** Revert the fix in a copy and confirm the test fails; a security test that has never failed proves nothing.

## Notes

- The same reasoning applies to anything you accept and then fetch: a webhook target, an image source, a "load config from" field. It is not specific to lists.
- Why it matters more than a normal SSRF-ish bug in an AI-adjacent app: content fetched from an attacker-chosen host may end up inside a model prompt. The allowlist is what keeps foreign text out of it.
- Backslashes deserve a thought too. Some parsers normalise `\\` to `//`; if yours might, include that shape in the corpus.
