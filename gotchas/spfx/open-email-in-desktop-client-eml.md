---
title: "Opening a pre-filled e-mail — with an attachment — in the user's desktop Outlook"
tags: [spfx, outlook, mailto, eml, mime, graph, email]
applies-to: SharePoint Online (SPFx web parts and extensions; any browser app that hands work off to a mail client)
last-reviewed: 2026-08-25
---

# Opening a pre-filled e-mail in the user's desktop Outlook

> **Bottom line.** A browser cannot detect which mail client the user has — no API exposes it, and "navigate to a protocol and watch for blur" is guesswork. Ask once and remember the answer. `mailto:` reliably reaches whatever client Windows has set as default (new *and* classic Outlook), but it cannot carry an attachment; for that, build the message as a `.eml` file and download it. The header that makes it work is **`X-Unsent: 1`** — without it Outlook (especially *new* Outlook) opens the file read-only and there is no Send button.
>
> **Ve zkratce.** Prohlížeč nemá jak zjistit, jakého poštovního klienta uživatel používá – žádné API to nedovolí. Zeptejte se jednou a volbu si zapamatujte. `mailto:` spolehlivě otevře klienta nastaveného ve Windows jako výchozí (nový i klasický Outlook), ale neunese přílohu; tu doručíte jako soubor `.eml` ke stažení. Klíčová je hlavička **`X-Unsent: 1`** – bez ní se soubor otevře jen ke čtení.

## The request

"Can it open my Outlook instead of Outlook on the web — and can it tell whether I use the new or the classic one?"

## What is actually possible

**1. Detection: no.** There is no browser API that reports the registered `mailto:` handler, and none that tells you whether `ms-outlook:` or `outlook:` resolves to anything. The common workaround — navigate to a custom protocol and infer success from a `blur`/`visibilitychange` that arrives within *n* milliseconds — produces false negatives on a cold client start and false positives when the browser shows its own "open with?" prompt. Do not ship a guess. **Ask once, store the choice** (`localStorage`), and let the user flip it later.

**2. Reaching the desktop: `mailto:`.** It hands off to whichever client the OS has as default. That answers the "new or classic Outlook?" question implicitly and correctly — you never need to know which one it is. Keep the body short; long bodies in a URL silently fail to open.

**3. An attachment cannot travel through `mailto:`.** The `attachment` parameter is ignored by every modern client for obvious security reasons. Two real options remain:

| | Draft via Graph | `.eml` file |
|---|---|---|
| Where it opens | Outlook on the web (`webLink`) | user's default mail client |
| Permission | `Mail.ReadWrite` (tenant-approved) | none |
| Needs an Exchange mailbox | yes | no |
| Practical size limit | ~3 MB (simple attachment POST) | whatever you are willing to hold in memory |

## Building the `.eml`

```ts
const boundary = '----myapp' + blob.size;
const eml = [
  'X-Unsent: 1',                                   // ← without this: read-only
  'Subject: ' + mimeWord(subject),                  // RFC 2047 for non-ASCII
  'To: ',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="' + boundary + '"',
  '',
  '--' + boundary,
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: base64',
  '',
  wrap76(b64Utf8(html)),
  '',
  '--' + boundary,
  'Content-Type: application/octet-stream; name="' + mimeWord(name) + '"',
  'Content-Transfer-Encoding: base64',
  'Content-Disposition: attachment; filename="' + mimeWord(name) + '"; '
    + "filename*=UTF-8''" + encodeURIComponent(name),
  '',
  wrap76(base64OfTheFile),
  '',
  '--' + boundary + '--',
  ''
].join('\r\n');

saveBlob(new Blob([eml], { type: 'message/rfc822' }), baseName + '.eml');
```

Details that bite:

- **`X-Unsent: 1` first.** This is the whole trick. New Outlook opens `.eml` in a reading view by default; the header switches it to compose.
- **CRLF line endings**, not `\n`. MIME parsers are strict about this.
- **Base64 wrapped at 76 characters.** One enormous line is rejected or mangled by some clients.
- **Non-ASCII needs encoding twice over**: the subject and the attachment name via RFC 2047 encoded-words (`=?UTF-8?B?…?=`), and the filename additionally as RFC 2231 (`filename*=UTF-8''…`) so newer clients get it right.
- **`btoa` only takes latin1** — convert through UTF-8 first (`encodeURIComponent` + `%XX` → char), and read binary content through `FileReader.readAsDataURL` if `Blob.arrayBuffer` is off-limits (it is under the ES2015 lib).
- **Revoke the object URL late** (a timeout of ~20 s after the click), not immediately — some browsers start the download after the handler returns.

## Consequences worth designing for

- Because the `.eml` route needs no Graph, **check the `Mail.ReadWrite` grant only when the user picks the web route**. Probing the mailbox every time the dialog opens is a request spent on a feature most people will not use — and a missing grant must not disable a path that never needed it.
- Downloading a file is not the same as a window popping open. Say so in the UI: "a ready-to-send message will be downloaded — open it and Outlook shows it as a new e-mail".
- Default the choice to where the users actually work, not to where your app runs.

## Checklist

- [ ] No client detection anywhere in the code — a remembered user choice instead.
- [ ] `mailto:` used for the desktop link route, with a short body.
- [ ] `.eml` carries `X-Unsent: 1`, CRLF endings and 76-char base64.
- [ ] Subject and filename encoded for non-ASCII (RFC 2047 + RFC 2231).
- [ ] Graph permission probed only on the web route.
- [ ] UI states plainly that a file will be downloaded.

## References

- MDN: [`mailto:` links](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a#mailto_links)
- Microsoft Support: [Open .eml, .msg, and .oft files in new Outlook](https://support.microsoft.com/en-gb/office/open-eml-msg-and-oft-files-in-new-outlook-60f71e69-e9a5-445b-b4dd-2e0d5aaf21d6)
- RFC 2047 (encoded-words), RFC 2231 (parameter value continuations)
