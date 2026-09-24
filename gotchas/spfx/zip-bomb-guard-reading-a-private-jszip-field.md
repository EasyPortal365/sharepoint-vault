---
title: Your zip-bomb guard reads a private JSZip field — and fails open on the next upgrade
short-title: A zip-bomb guard on a private JSZip field fails open
summary: "`entry._data.uncompressedSize` is an implementation detail, and `undefined → allow` turns the next library upgrade into a silent loss of protection; read the declared sizes from the ZIP central directory instead"
tags: [spfx, client-side, security, office-files]
applies-to: SharePoint Online (SPFx, any browser client)
last-reviewed: 2026-09-19
---

# Your zip-bomb guard reads a private JSZip field — and fails open on the next upgrade

> **Bottom line.** A size cap that reads `entry._data.uncompressedSize` from JSZip and treats `undefined` as "let it through" disappears the day the library renames that field — silently, with no crash and no log. Read the declared sizes from the ZIP central directory instead: it is the standard format, so a library upgrade cannot move it.
>
> **Ve zkratce.** Strop, který čte `entry._data.uncompressedSize` z JSZipu a `undefined` překládá na „pusť to dál“, zmizí v den, kdy knihovna to pole přejmenuje – tiše, bez pádu a bez záznamu. Čti deklarované velikosti z centrálního adresáře ZIPu: to je standardní formát, který upgrade knihovny neposune.

## Symptom

Nothing. That is the whole problem.

A `.docx` / `.xlsx` / `.pptx` is a ZIP, and a 200 kB file can inflate to gigabytes in memory. So you cap it **before** handing the archive to `mammoth` / SheetJS, using metadata rather than decompression:

```ts
function zipEntrySize(entry) {
  const d = entry ? entry._data : undefined;
  return d && typeof d.uncompressedSize === 'number' ? d.uncompressedSize : undefined;
}

// …
const size = zipEntrySize(zip.files[name]);
if (size === undefined) return false;   // "size unknown — let it through"
```

Tests pass. `npm ls` is clean. TypeScript is happy — `_data` is `any`. Then you bump JSZip, the internal field changes shape, `size` is `undefined` for every entry, and the guard returns `false` every single time. Your protection is gone and **nothing reports it**.

## Cause

`_data` is a private implementation detail. Nothing in the package contract promises it exists, keeps its name, or keeps holding `uncompressedSize` — so a patch release may legitimately change it.

The deadly part is not the dependency itself; it is the **direction of the fallback**. `undefined → return false` means "I could not measure it, so I will allow it". That is fail-open, and fail-open in a place nobody watches is indistinguishable from having no guard at all.

## Fix

Read the sizes from the **ZIP central directory**. It is a documented, stable on-disk format; parsing it is a few dozen lines and depends on nothing.

```ts
const ZIP64_SENTINEL = 0xFFFFFFFF;   // real size lives in the extra header — treat as over the cap
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;

/** End of central directory. The ZIP comment is at most 64 kB, so stop there. */
function findEocd(dv: DataView, len: number): number {
  const stop = Math.max(0, len - 65558);
  for (let i = len - 22; i >= stop; i--) {
    if (dv.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Declared uncompressed sizes. The input is UNTRUSTED, so every offset is
 * bounds-checked and the first inconsistency ends the walk.
 * An empty array means "metadata unreadable" — the caller behaves as before.
 */
export function readZipDeclaredSizes(buffer: ArrayBuffer): Array<{ name: string; declaredSize: number }> {
  const out: Array<{ name: string; declaredSize: number }> = [];
  try {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    if (len < 22) return out;
    const dv = new DataView(buffer);
    const eocd = findEocd(dv, len);
    if (eocd < 0) return out;
    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < count; n++) {
      if (ptr < 0 || ptr + 46 > len) break;
      if (dv.getUint32(ptr, true) !== CENTRAL_DIR_SIGNATURE) break;
      const declaredSize = dv.getUint32(ptr + 24, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      if (ptr + 46 + nameLen > len) break;
      let name = '';
      for (let i = 0; i < nameLen; i++) name += String.fromCharCode(bytes[ptr + 46 + i]);
      out.push({ name: name, declaredSize: declaredSize });
      ptr += 46 + nameLen + extraLen + commentLen;
    }
  } catch {
    return [];
  }
  return out;
}
```

Use it as the **first** gate, before the archive reaches any parser:

```ts
function exceedsCap(buffer: ArrayBuffer, parts: RegExp, limit: number): boolean {
  const entries = readZipDeclaredSizes(buffer);
  if (entries.length === 0) return false;   // unreadable metadata — later caps still apply
  let total = 0;
  for (const e of entries) {
    if (!parts.test(e.name)) continue;
    if (e.declaredSize >= ZIP64_SENTINEL) return true;
    total += e.declaredSize;
    if (total > limit) return true;
  }
  return false;
}

// .docx text parts; images are not inflated into strings, so they would only cause false alarms
if (exceedsCap(buffer, /^word\/.+\.xml$/, MAX_CHARS)) throw new Error(TOO_LARGE_MSG);
```

## Notes

- **The declared size may lie**, because the attacker writes it. It can only lie *downwards*, though, and that direction is covered by the second layer: cap the string you actually produced (`text.length`) as well. This is a cheap first gate, not the only defence.
- **ZIP64** stores `0xFFFFFFFF` as a sentinel and the real size in an extra header. Do not bother parsing it — an archive that needs ZIP64 is over any sane client-side cap by definition.
- **Comparing bytes against a character limit is fine here** and errs the safe way: UTF-8 bytes are always ≥ characters, so the estimate is conservative.
- **Guard the guard.** A cap this quiet deserves a build-time check that (a) the private field appears nowhere in live code and (b) the cap sits *before* the parser call in every extraction path — and the check must be run against deliberately sabotaged sources, or it can pass while measuring nothing.
- Same trap, different shape: any protection built on a private field of a third-party package carries a hidden expiry date. If you cannot avoid one, make the unknown case **fail closed**, not open.
