---
title: "`speechSynthesis.cancel()` does not stop chunked reading — it queues the next chunk"
tags: [spfx, web-speech-api, browser, react, accessibility]
applies-to: Chromium-based browsers (SharePoint Online / SPFx and any web app)
last-reviewed: 2026-07-27
---

# `speechSynthesis.cancel()` does not stop chunked reading — it queues the next chunk

> **Bottom line.** If you read long text as a *chain* of utterances (each `onend` queues the next), `cancel()` ends only the utterance currently speaking — which fires its `onend`, which queues the next chunk. Your Stop button appears to do nothing. Guard the chain with an epoch counter and bump it *before* `cancel()`.
>
> **Ve zkratce.** Když dlouhý text čtete jako ŘETĚZ utterancí (každý `onend` naqueueuje další), `cancel()` ukončí jen právě znějící utterance – tím vystřelí její `onend`, a ten pošle do fronty další dávku. Tlačítko Stop vypadá jako mrtvé. Řetěz ohlídejte generačním čítačem, který zvýšíte PŘED `cancel()`.

## Symptom

Read-aloud works. Then:

- Clicking **Stop** silences the voice for a moment and it carries straight on with the next sentence. The user has to click Stop as many times as there are chunks.
- Starting read-aloud on a *different* message plays both texts over each other.
- Short texts are fine — the bug only shows above your chunk threshold.

## Cause

Speech engines cap utterance length (roughly 1–2k characters in practice), so the usual pattern splits the text and chains it:

```ts
const speakNext = (): void => {
  if (idx >= chunks.length) { onEnd(); return; }
  const u = new SpeechSynthesisUtterance(chunks[idx++]);
  u.onend = () => speakNext();      // ← the chain
  synth.speak(u);
};
```

`cancel()` clears the queue and stops the current utterance — **and fires its `onend`**. That handler is your own chain, so it immediately queues chunk *n+1*. From the outside it looks as if cancel was ignored.

A local `cancelled` flag does not help unless every path that can stop playback sets it — and `stopSpeaking()` usually lives in a different module from the closure that owns the flag.

## Fix

Give every `speak()` call an epoch. The chain continues only while its epoch is current:

```ts
let gen = 0;   // module scope

export function speak(text: string, onEnd: () => void): void {
  const my = ++gen;              // new read = new epoch (also pre-empts a running chain)
  try { window.speechSynthesis.cancel(); } catch { /* */ }

  const chunks = splitIntoChunks(text);
  let idx = 0;
  const speakNext = (): void => {
    if (my !== gen) return;               // superseded → end silently, no onEnd
    if (idx >= chunks.length) { onEnd(); return; }
    const u = new SpeechSynthesisUtterance(chunks[idx++]);
    u.onend = () => speakNext();
    u.onerror = () => { if (my === gen) onEnd(); };
    window.speechSynthesis.speak(u);
  };
  speakNext();
}

export function stopSpeaking(): void {
  gen++;                                   // ← BEFORE cancel(), or the onend still queues
  try { window.speechSynthesis.cancel(); } catch { /* */ }
}
```

Two details that matter:

- **Bump the epoch before `cancel()`.** Afterwards is too late: `cancel()` synchronously fires `onend` in some browsers.
- **Do not call `onEnd()` from a superseded chain.** The caller that pressed Stop already reset its own "speaking" state; a late callback would clear the state of the *new* reading instead. Document this, because "onEnd fires on stop too" is the intuitive contract and it is the wrong one here.

## The general pattern

This is not really about speech. Any **self-queueing chain** where the cancel API works per-step has the same hole: chunked uploads that queue the next part in `onload`, progressive renderers that schedule the next frame in a callback, paged fetch loops driven by `then`. If cancellation is per-step but continuation is automatic, cancellation loses. An epoch counter (or an `AbortController` checked at every step boundary) is the fix.

## How to verify

1. Read an answer longer than your chunk threshold (add up the chunk size — 1500 chars is a common limit).
2. Press Stop once. It must go quiet and stay quiet, and the button must return to its idle state.
3. Start reading message A, then message B while A is still speaking. Only B may be audible.
