---
title: A REST write over 2 MB fails with "The request message is too big"
short-title: REST request body is capped at 2 MB
summary: "SharePoint Online rejects any REST request whose body exceeds 2,097,152 bytes (after JSON escaping, in UTF-8). A multi-line text field in a list holds far more than that – the cap is the request, not the field – so measure body bytes and split large JSON into parts."
tags: [rest-api, lists]
applies-to: SharePoint Online
last-reviewed: 2026-10-26
---

# A REST write over 2 MB fails with "The request message is too big"

> **Bottom line.** SharePoint Online caps the body of one REST request at 2,097,152 bytes. Anything that grows with the tenant (snapshots, imports, JSON blobs in a list item) must be measured in body bytes and split into parts before it hits the cap.
>
> **Ve zkratce.** SharePoint Online přijme v jednom REST požadavku nejvýš 2 097 152 bajtů těla. Co roste s velikostí tenantu (snímky, importy, JSON v položce), měř v bajtech těla a před stropem rozlož do částí.

## Symptom

Creating or updating a list item with a large multi-line text value returns HTTP 400:

```json
{"odata.error":{"code":"-1, Microsoft.SharePoint.Client.InvalidClientQueryException",
 "message":{"lang":"en-US","value":"The request message is too big. The server does not allow messages larger than 2097152 bytes."}}}
```

It works in development and breaks only on a big tenant, because the payload (an inventory snapshot, a pasted PowerShell export) grows with the number of sites.

## Cause

The limit is on the **HTTP request body**, not on the field. Measured on SharePoint Online (October 2026):

| Value written to a multi-line text field in a list | Result |
|---|---|
| 1.5 M characters (ASCII) | `201 Created`, read back 1,536,000 characters |
| 2 MB / 8 MB | `400 The request message is too big` |

So the often-quoted 63,999-character limit is not what stops you in a list – the 2 MB request cap is. The cap counts **bytes after serialization**: the value is JSON-escaped inside the request body (every `"` becomes `\"`) and encoded as UTF-8 (accented letters take 2 bytes, many symbols 3). A 1 M-character JSON string with diacritics can easily exceed 2 MB.

## Fix

Measure the real body size, and above a safe threshold store a header item plus parts in a separate list:

```ts
const SINGLE_MAX_BYTES = 1500000;   // safely under 2,097,152
const PART_CHARS = 300000;          // one part stays under the cap even at 3 bytes/char + escaping

function bodyBytes(json: string): number {
  return new Blob([JSON.stringify(json)]).size;   // size of the value as it travels in the body
}

if (bodyBytes(json) <= SINGLE_MAX_BYTES) {
  await post(listUrl, { Title, Payload: json, Status: 'done' });
} else {
  const head = await post(listUrl, { Title, Payload: '', Status: 'running' });  // hidden from readers
  try {
    const parts = split(json, PART_CHARS);                                       // don't split a surrogate pair
    for (let i = 0; i < parts.length; i++) await post(partsUrl, { ParentId: head.Id, PartIndex: i + 1, Payload: parts[i] });
    await merge(itemUrl(head.Id), { Parts: parts.length, Status: 'done' });     // confirm only at the end
  } catch (e) {
    await deletePartsAndHeader(head.Id);                                         // no half-written record
    throw e;
  }
}
```

Reading is strict: load all parts for the header, and if their count differs from `Parts`, fail instead of concatenating what you got – half a JSON either fails to parse (the lucky case) or parses into a record that silently lacks data.

## Notes

- A separate parts list (rather than extra rows in the main list) keeps parts out of every view and query of the main list – nobody can forget to filter them out.
- `MERGE` has the same cap: rewriting a large record in place fails the same way, so updates need the same split path (and must delete parts left over from a previous, larger version).
- Don't store raw user input you only parse later (for example a pasted `Get-SPOSite | ConvertTo-Json` export) – keep only the fields you read. It keeps configuration items far below the cap.
- Split on a character boundary that does not cut a UTF-16 surrogate pair in half.
