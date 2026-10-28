---
title: "Azure TTS HD voices are generative — the same sentence gives a different recording each time, so verify every file by transcription"
short-title: "Azure HD voice is generative — verify by transcription"
summary: DragonHD output varies per call and sometimes garbles a term; transcribe each MP3 with fast transcription and regenerate on a miss. Use <lang> for a non-native language, playbackRate instead of the unsupported <prosody>, and honor Retry-After on 429
tags: [azure, speech, text-to-speech, ssml, tooling]
applies-to: Azure AI Speech REST (text-to-speech v1, fast transcription 2024-11-15), HD voices such as en-US-Andrew:DragonHDLatestNeural
last-reviewed: 2026-10-28
---

# Azure TTS HD voices are generative — verify every recording by transcription

> **Bottom line.** HD voices (`…:DragonHDLatestNeural`) are a generative model, not concatenated phonemes: the same SSML produces a different recording on every call, and now and then a term comes out garbled ("CRM" heard as "cr"). A listening pass you did once guarantees nothing about the next generation. Pre-generate the audio, send each MP3 straight to fast transcription and check that the terms you care about are in the transcript; regenerate up to a few times, then flag the file for a human to listen to.
>
> **Ve zkratce.** HD hlasy (`…:DragonHDLatestNeural`) jsou generativní model: stejné SSML dá při každém volání jinou nahrávku a občas pojem zkomolí („CRM“ jako „cr“). Jednou schválený poslech nic nezaručuje pro příští generování. Nahrávky vyrábějte předem, každou MP3 pošlete na rychlý přepis a zkontrolujte, že v přepisu jsou hlídané pojmy; při chybě generujte znovu (pár pokusů), pak soubor označte k poslechu člověkem.

## Symptom

A batch of short narration clips sounds fine. You regenerate one sentence after a small wording change elsewhere — and a product acronym in an *unchanged* sentence now sounds wrong. Nothing in the request changed.

## Why

HD voices sample their output: Microsoft's HD voices article describes "slight variations in each output" and a `temperature` parameter that defaults to 1.0. Prosody, timing and occasionally pronunciation differ between calls even with byte-identical SSML. Treat each recording as a new draft, not as a deterministic build artifact.

## Fix: synthesize → transcribe → compare

```js
// 1) Synthesize (text-to-speech REST v1)
const ssml =
  '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="cs-CZ">' +
  '<voice name="en-US-Andrew:DragonHDLatestNeural">' +
  '<lang xml:lang="cs-CZ">' + escapeXml(spokenText) + '</lang>' +   // non-native language → <lang>
  '</voice></speak>';
const tts = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
  method: 'POST',
  headers: {
    'Ocp-Apim-Subscription-Key': key,
    'Content-Type': 'application/ssml+xml',
    'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    'User-Agent': 'my-voice-builder'
  },
  body: ssml
});
const mp3 = Buffer.from(await tts.arrayBuffer());

// 2) Transcribe the MP3 directly (fast transcription, works on the free F0 tier)
const fd = new FormData();
fd.append('audio', new Blob([mp3], { type: 'audio/mpeg' }), 'clip.mp3');
fd.append('definition', JSON.stringify({ locales: ['cs-CZ'] }));
const stt = await fetch(
  `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`,
  { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: fd });
const heard = ((await stt.json()).combinedPhrases || []).map(p => p.text).join(' ');

// 3) Every watched term must appear in `heard`; otherwise regenerate (max ~3 attempts),
//    keep the attempt with the fewest misses and put it on a "listen to this" list.
```

The transcript is a sieve, not a judge: it cannot tell similar-sounding short tokens apart, and it says nothing about the quality of individual sounds. New terms still need one human listening pass.

## Related traps on the same API

- **Non-native language needs `<lang>`.** A multilingual English HD voice speaks Czech (or another language) only when the text is wrapped in `<lang xml:lang="…">` inside `<voice>`. Without it you get the language read with English phonetics.
- **No `<prosody>` (and no `<emphasis>`, `<audio>`, `mstts:silence`) on HD voices** — see the SSML support table in Microsoft's HD voices article. Control speed on playback (`audio.playbackRate`), not in SSML. The same table lists `<sub>`, `<phoneme>` and alias-only `<lexicon>` as supported on DragonHD (not `<phoneme>` on Dragon HD Omni). We fix pronunciation by **substituting the text** before synthesis instead (a small lexicon: term → spelling the voice reads correctly; keep any inflection suffix that follows the term): it works the same for every voice model and the transcription check can test it. In our tests, acronyms came out clearest spelled letter by letter with hyphens.
- **Less variation is configurable.** The voice element takes `parameters='temperature=…'` (0–1, default 1.0; lower = more predictable) and `enhancePronunciation=true` for acronyms and proper nouns. Neither makes the output deterministic, so keep the transcription check.
- **Hash the text you show, not the text you send.** If file names come from a hash of the displayed text, a lexicon change does not change the hash — delete the affected files explicitly and regenerate.
- **429 on the free tier.** Read `Retry-After` (seconds) and wait that long, a bounded number of times; run requests sequentially.
- **Keep the key out of the repo and out of logs.** Read it from a file outside any git working tree and refuse to start if the file is inside one; never echo the key in errors.
