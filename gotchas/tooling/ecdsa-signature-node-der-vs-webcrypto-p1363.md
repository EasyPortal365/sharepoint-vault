---
title: "An ECDSA signature made in Node fails crypto.subtle.verify in the browser — Node defaults to DER, WebCrypto expects raw r||s"
short-title: "ECDSA: Node DER vs WebCrypto r||s"
summary: crypto.sign in Node returns a DER-encoded ECDSA signature (69–72 bytes); WebCrypto verify in an SPFx bundle expects IEEE P1363 (64 bytes for P-256) and just returns false. Sign with dsaEncoding ieee-p1363, check the length, and test both directions with a DER counterexample
tags: [spfx, security, webcrypto, node, signing, tooling]
applies-to: Node.js 18+ (node:crypto sign/verify), WebCrypto crypto.subtle (ECDSA P-256 / SHA-256) in browsers and SPFx bundles, measured November 2026
last-reviewed: 2026-11-12
---

# An ECDSA signature made in Node fails WebCrypto verify — DER vs raw r||s

> **Bottom line.** You sign a file in a Node script (`crypto.sign('sha256', data, privateKey)`) and verify it in the browser or an SPFx bundle with `crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, …)`. Verification returns `false` with no error. Node encodes ECDSA signatures as **DER** by default (69–72 bytes for P-256, measured on 5,000 signatures). WebCrypto expects **IEEE P1363**: the raw `r || s`, exactly 64 bytes for P-256. Sign with `{ key, dsaEncoding: 'ieee-p1363' }`, reject any signature that is not 64 bytes long, and keep a test that verifies a Node signature with the browser code plus a DER counterexample that must fail.
>
> **Ve zkratce.** Podpis ECDSA z Node (`crypto.sign`) neprojde `crypto.subtle.verify` v prohlížeči ani v SPFx: Node podepisuje ve formátu **DER** (69–72 bajtů), WebCrypto čeká **IEEE P1363** – holé `r || s`, u P-256 přesně 64 bajtů. Ověření jen vrátí `false`, chybu nevyhodí. Podepisujte s `dsaEncoding: 'ieee-p1363'`, podpis jiné délky odmítněte a mějte test v obou směrech s protipříkladem v DER.

## Symptom

- A file signed by your build or admin script never verifies in the client. `crypto.subtle.verify` resolves to `false`; nothing throws.
- The same signature verifies fine in Node with `crypto.verify`. The two halves of your system disagree, and each looks correct on its own.

## Cause

ECDSA produces two integers, `r` and `s`. There are two common ways to serialize them:

| Encoding | Shape | Who uses it by default |
|---|---|---|
| DER (ASN.1 `SEQUENCE { INTEGER r, INTEGER s }`) | variable length, 69–72 bytes for P-256 | Node `crypto.sign`, OpenSSL, most CLI tools |
| IEEE P1363 | fixed `r || s`, 32 + 32 = 64 bytes for P-256 | WebCrypto `crypto.subtle.sign` / `verify` |

WebCrypto has no option to accept DER. A DER signature is just bytes that do not match, so the result is `false`.

## Fix

Sign in Node in the format the browser expects:

```js
import { sign, verify } from 'node:crypto';

const signature = sign('sha256', Buffer.from(payload, 'utf8'), {
  key: privateKey,            // KeyObject or PEM
  dsaEncoding: 'ieee-p1363'   // raw r||s, what WebCrypto expects
});
// signature.length === 64 for P-256
```

Verify in the browser or the SPFx bundle:

```ts
const pub = await crypto.subtle.importKey(
  'jwk', { kty: 'EC', crv: 'P-256', x, y, ext: true },
  { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const sig = base64ToBytes(signatureB64);
if (sig.length !== 64) return false;          // DER or garbage: reject early, fail closed
const ok = await crypto.subtle.verify(
  { name: 'ECDSA', hash: 'SHA-256' }, pub, sig, new TextEncoder().encode(payload));
```

If Node has to verify a WebCrypto signature, pass the same option: `verify('sha256', data, { key: pub, dsaEncoding: 'ieee-p1363' }, sig)`.

## Make it testable

- Build the signed string in **one** function and use that function on both sides. A different separator, a trailing newline or a different case in an identifier gives the same silent `false`.
- Keep a test that signs with Node (`ieee-p1363`) and verifies with the browser code, and a **counterexample** that signs the same payload with default DER and expects `false`. Without the counterexample, a verifier that always returns `true` would pass too.
- If the public keys live in several places (a script, a browser page, a server), test that all copies are identical. A typo in one coordinate is otherwise invisible until a customer is affected.

## Related

- [SPFx: SRI integrity via manifest path](../spfx/spfx-sri-integrity-via-manifest-path.md) – signing the list of versions a thin SPFx loader trusts.
