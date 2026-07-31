---
title: Getting bulk data into a SharePoint page from the console — a localhost server beats pasting, and beats uploading it somewhere
tags: [tooling, browser-console, sharepoint-online, cors, mixed-content, data-migration]
applies-to: SharePoint Online, any browser DevTools / automation console
last-reviewed: 2026-07-31
---

# Getting bulk data into a SharePoint page from the console — a localhost server beats pasting, and beats uploading it somewhere

> **Bottom line.** To drive a bulk REST import from a SharePoint page you need the data *inside* that page. Pasting 100+ kB into the console is slow and fragile, and uploading it to a public raw-file host leaks whatever the data contains. Serve it from `http://127.0.0.1` with `Access-Control-Allow-Origin: *` and `fetch` it from the page — localhost is a *potentially trustworthy origin*, so mixed-content blocking does not apply, and the data never leaves the machine.
>
> **Ve zkratce.** Hromadný REST import řízený ze stránky SharePointu potřebuje data uvnitř té stránky. Vkládat 100+ kB do konzole je pomalé a křehké, nahrát je na veřejný raw hosting znamená únik obsahu. Naservíruj je z `http://127.0.0.1` s `Access-Control-Allow-Origin: *` a načti `fetch`em — localhost je *potentially trustworthy origin*, takže se neuplatní blokace mixed content, a data nikdy neopustí stroj.

## Situation

You have a few hundred rows (a migration, a bulk import, a reconciliation list) and you want to write them
through SharePoint REST. The page is the only place with a working authenticated session — the site cookies,
the form digest, the right site context. So the loop has to run in the page.

Three ways to get the data there, two of them bad:

| Approach | Problem |
|---|---|
| Paste the JSON into the console | 100+ kB literals are slow, easy to truncate, and escaping bites you |
| Upload to a public raw-file host and `fetch` it | Works (those hosts send `Access-Control-Allow-Origin: *`) but **publishes the payload** — never acceptable for personal data, and a private repo is not a fix |
| Serve from `127.0.0.1` | No size limit, no escaping, nothing leaves the machine |

## Why localhost works from an HTTPS page

An HTTPS page normally cannot fetch `http://` — mixed content is blocked. But the spec carves out
loopback: `http://localhost`, `http://127.0.0.1` and `http://[::1]` count as
[potentially trustworthy origins](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy),
so the mixed-content check passes.

CORS still applies — but the server is yours, so you just allow it.

## Recipe

```js
// serve-payload.js — run with: node serve-payload.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'payload.json');

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  if (req.url.indexOf('/payload.json') === 0) { res.writeHead(200); return res.end(fs.readFileSync(FILE)); }
  res.writeHead(404); res.end('{}');
}).listen(8765, '127.0.0.1', () => console.log('http://127.0.0.1:8765/payload.json'));
```

Then, in the page console:

```js
const payload = await (await fetch('http://127.0.0.1:8765/payload.json')).json();
payload.rows.length;   // sanity-check the count before writing anything
```

Bind to `127.0.0.1`, **not** `0.0.0.0` — otherwise the payload is readable by anything on the network.
Kill the server the moment the import is done.

## Writing the rows

Once the data is in the page, the write loop is ordinary SharePoint REST. Two things worth stating,
because both bite people running REST from a raw `fetch` rather than from a framework HTTP client:

```js
const web = location.pathname.split('/SitePages/')[0];

// Fresh digest — the auto page digest expires (~30 min) and you get a confusing
// 403 "The security validation for this page is invalid" mid-import.
const digest = async () => (await (await fetch(web + '/_api/contextinfo',
  { method: 'POST', headers: { Accept: 'application/json;odata=nometadata' } })).json()).FormDigestValue;

// Address the list by URL, not by title — a renamed list keeps its URL.
const listApi = n => `${web}/_api/web/GetList('${encodeURIComponent(web + '/Lists/' + n)}')`;

const post = async (list, body) => {
  const r = await fetch(listApi(list) + '/items', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json;odata=nometadata',   // plain body, NO __metadata
      'X-RequestDigest': await digest()
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 400));
  return r.json();
};
```

Refresh the digest every few minutes rather than per request, and make the loop **idempotent**:
read the existing items first, index them by the natural key, and skip what is already there.
A bulk import that cannot be safely re-run will be re-run anyway, on the day it fails halfway.

## Practical notes

- **Run the loop detached and poll.** Automation bridges (CDP, Playwright's `evaluate`) time out waiting
  for a long-running expression, while the page happily keeps working. Start the async loop, stash progress
  on `window`, and poll it with short calls — a wait timeout is not a failure of the work.
- **Verify by reading back, not by counting successes.** Re-fetch the list and diff every field against
  the payload. Include a positive control (assert that a value you *know* is there really shows up),
  otherwise a broken check reports a clean run.
- **A page reload wipes your helpers.** Anything you hung on `window` is gone; re-create it before polling.

## See also

- [SharePoint REST writes: `odata=nometadata` and no `__metadata`](../rest-api/)
- [Address lists by URL, not by title](../lists/)
