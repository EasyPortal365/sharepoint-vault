---
title: Write to Azure Table Storage from a Node Azure Function — no SDK, SharedKeyLite
tags: [azure-functions, table-storage, rest-api, telemetry]
applies-to: Azure Functions (Node 18+), Azure Table Storage
last-reviewed: 2026-08-06
---

# Write to Azure Table Storage from a Node Azure Function — no SDK, SharedKeyLite

**When to reach for it:** lightweight telemetry, counters, or audit rows from an Azure Function when you don't want `@azure/data-tables` (and its `@azure/core-*` tree) bloating a zip-deployed package. The function already has a storage account — `AzureWebJobsStorage` — so a signed REST call is all you need. ~80 lines, builtin `crypto` only.

```ts
import { createHmac } from 'crypto';

interface TableAccount { account: string; key: Buffer; endpoint: string; }

/** Parse AzureWebJobsStorage. Returns null for dev storage (emulator) — treat as "feature off". */
function parseStorageCs(cs: string): TableAccount | null {
  if (!cs || cs.indexOf('UseDevelopmentStorage') !== -1) { return null; }
  const parts: Record<string, string> = {};
  for (const seg of cs.split(';')) {
    const eq = seg.indexOf('=');               // AccountKey ends with '==' — split on FIRST '=' only
    if (eq > 0) { parts[seg.slice(0, eq).trim()] = seg.slice(eq + 1).trim(); }
  }
  if (!parts['AccountName'] || !parts['AccountKey']) { return null; }
  const suffix = parts['EndpointSuffix'] || 'core.windows.net';
  const endpoint = (parts['TableEndpoint']
    || `https://${parts['AccountName']}.table.${suffix}`).replace(/\/+$/, '');
  return { account: parts['AccountName'], key: Buffer.from(parts['AccountKey'], 'base64'), endpoint };
}

/** Signed Table service request. resourcePath = '/Tables' | '/MyTable' | '/MyTable()' — NO query string. */
async function tableRequest(
  acc: TableAccount, method: 'GET' | 'POST',
  resourcePath: string, query: string, body?: string
): Promise<Response> {
  const date = new Date().toUTCString();
  // SharedKeyLite for TABLE service: Date + "\n" + CanonicalizedResource. That's all.
  // (Blob/Queue SharedKeyLite is a DIFFERENT, longer format — don't mix them up.)
  const stringToSign = `${date}\n/${acc.account}${resourcePath}`;
  const signature = createHmac('sha256', acc.key).update(stringToSign, 'utf8').digest('base64');
  const headers: Record<string, string> = {
    'Authorization': `SharedKeyLite ${acc.account}:${signature}`,
    'x-ms-date': date,
    'x-ms-version': '2019-02-02',
    'DataServiceVersion': '3.0;NetFx',
    'Accept': 'application/json;odata=nometadata'
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Prefer'] = 'return-no-content';    // insert returns 204 instead of echoing the entity
  }
  return fetch(`${acc.endpoint}${resourcePath}${query}`, { method, headers, body });
}

// Create table once (idempotent): 201/204 created, 409 already exists — both fine.
await tableRequest(acc, 'POST', '/Tables', '', JSON.stringify({ TableName: 'MyTelemetry' }));

// Insert an entity:
await tableRequest(acc, 'POST', '/MyTelemetry', '', JSON.stringify({
  PartitionKey: '202608',                        // e.g. YYYYMM for monthly partitions
  RowKey: `${Date.now()}_${crypto.randomUUID()}`, // unique + roughly time-ordered
  count: 1
}));

// Query a partition (paged):
const res = await tableRequest(acc, 'GET', '/MyTelemetry()',
  `?$filter=${encodeURIComponent(`PartitionKey eq '202608'`)}`);
const rows = (await res.json()).value;
// continuation: response headers x-ms-continuation-NextPartitionKey / -NextRowKey →
// re-issue with &NextPartitionKey=...&NextRowKey=... until the header disappears.
```

Key points:

- **Table SharedKeyLite ≠ Blob SharedKeyLite.** The Table string-to-sign is just `Date\n/{account}{path}`; the Blob/Queue variant includes method, headers and more. Using the Blob format against Table gets you an eternal 403 with no useful detail.
- **The query string is NOT signed** for Table SharedKeyLite (no `comp=` in normal CRUD) — sign the resource path only, send `$filter` etc. unsigned.
- **Split the connection string on the first `=` per segment** — the base64 `AccountKey` ends in `==` and a naive `split('=')` corrupts it.
- **`RowKey`/`PartitionKey` forbidden characters:** `/ \ # ?` — timestamps + GUIDs are safe.
- Numbers serialize as `Edm.Int32`/`Edm.Double` automatically; integers within int32 range need no `odata.type` annotation.
- Wrap writes in try/catch with a short `AbortController` timeout if the row is telemetry — a metering hiccup must never take down the request that produced it (fail-open).
- Works against sovereign clouds too: honor `EndpointSuffix` / explicit `TableEndpoint` instead of hard-coding `core.windows.net`.
