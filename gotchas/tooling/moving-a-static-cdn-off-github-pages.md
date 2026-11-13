---
title: Moving a static CDN off GitHub Pages without breaking the apps that load from it
summary: "Upload git blobs, not a Windows working tree (CRLF breaks SRI); allow the new CA in CAA; missing files must stay 404, not 403; Azure static website has no CORS and Front Door ignores the query string by default; folders without a trailing slash; upload content before pointers"
tags: [cdn, github-pages, azure-storage, azure-front-door, cloudflare, caching, cors, sri, dns, deployment]
applies-to: SPFx solutions (or any web app) loading scripts, JSON, fonts or audio from a static host under a custom domain, when that host changes
last-reviewed: 2026-11-13
---

# Moving a static CDN off GitHub Pages without breaking the apps that load from it

> **Bottom line.** GitHub's terms say Pages is not for running an online business or commercial SaaS, so a CDN for paid apps eventually has to move. Keeping the hostname means no app has to be redeployed — but the new host must reproduce Pages' behaviour exactly: the same bytes (git blobs with LF, not a Windows checkout), `Access-Control-Allow-Origin: *`, 404 for missing files, a cache key that includes the query string, `max-age` you already rely on, and 301 for folders without a trailing slash. Verify every file over HTTP against git before you switch DNS, and get the certificate issued before the CNAME moves.
>
> **Ve zkratce.** Podmínky GitHubu říkají, že Pages nejsou na provoz komerčního SaaS, takže CDN placených aplikací se dřív nebo později stěhuje. Se stejným hostname se nemusí přeinstalovat žádná appka – nový hosting ale musí přesně zopakovat chování Pages: stejné bajty (git bloby s LF, ne checkout z Windows), `Access-Control-Allow-Origin: *`, 404 pro chybějící soubor, cache klíč včetně query stringu, `max-age`, na který už spoléháte, a 301 u složky bez lomítka. Před přepnutím DNS ověř každý soubor přes HTTP proti gitu a certifikát nech vydat ještě před změnou CNAME.

## Symptom

After pointing the CNAME at the new host, everything "looks fine" in a quick test — and then one of these shows up:

- every app refuses to start with an integrity error (SRI or your own signed fingerprints don't match);
- the new host never gets a certificate, the custom domain stays "pending";
- licence or feature checks report an error instead of "not found";
- audio players and web fonts silently fail, `fetch()` of JSON throws a network error;
- cache-busted URLs (`?cb=123`) keep returning yesterday's `versions.json`;
- a folder URL without a trailing slash renders a page whose relative links are broken.

## Cause and fix, one by one

1. **Line endings.** On Windows with `core.autocrlf=true` the working tree has CRLF in text files; Pages serves the git blobs (LF). If you hash or SRI-pin files from the index (as you should), uploading the working tree changes the bytes. → Upload from a Linux CI checkout, or read blobs with `git cat-file`, and compare each file's git blob SHA-1 (`sha1("blob <len>\0" + bytes)`) with the tree entry before uploading.
2. **CAA.** A zone that only allows `letsencrypt.org` blocks other CAs. Azure Front Door managed certificates come from DigiCert (`0 issue "digicert.com"`); Cloudflare may use Google Trust Services (`pki.goog`) or SSL.com. Add the record before domain validation. CAA can't sit on the CNAME'd name itself — put it on the apex.
3. **404 vs 403.** Pages answers 404. A private blob endpoint, or an object store without public listing, often answers 403 — and code that treats 404 as "no licence/feature" and anything else as an error now breaks. Azure's *static website* endpoint returns 404; use it as the origin, not the blob endpoint.
4. **CORS.** Azure Storage's CORS rules don't apply to the static website endpoint ([docs](https://learn.microsoft.com/azure/storage/blobs/storage-blob-static-website)). Add `Access-Control-Allow-Origin: *` with a Front Door rule set — on every response, including 404s, or a cross-origin `fetch` of a missing file throws instead of returning 404. `<audio crossorigin>` with Web Audio and cross-origin `@font-face` need it too.
5. **Query string in the cache key.** Front Door's default is to ignore it. With `?cb=` busting, set the route's query string caching to *use query string*. Keep the `Cache-Control` you had (Pages: `max-age=600`) as a blob property so the semantics don't change.
6. **Folders.** Pages redirects `/docs` → `/docs/`. Static website serves `index.html` directly at `/docs`, so relative links resolve one level too high. Add a redirect rule for paths without a file extension and without a trailing slash (`{url_path}/`).
7. **Atomicity.** Pages publishes a commit at once; uploading blobs one by one does not. Upload immutable content first (hashed bundles, chunks, media), then manifests and stable loaders, then the top-level pointers (`versions.json`, `releases.json`…), and delete removed files last.
8. **Size limits of the alternatives.** Azure Static Web Apps cap one environment at 500 MB and 15 000 files ([quotas](https://learn.microsoft.com/azure/static-web-apps/quotas)); Cloudflare Pages allows 20 000 files and 25 MiB per file on the free plan ([limits](https://developers.cloudflare.com/pages/platform/limits/)); an R2 custom domain needs the zone on Cloudflare.

## Cutover without downtime

1. Upload everything, then **download every file through the new endpoint** and compare SHA-256 with git, plus headers (status, `Content-Type`, ACAO, `Cache-Control`), a 404 probe, a `Range` request (206) and a folder index. In CI this takes well under a minute for ~900 MB.
2. Validate the custom domain with the provider's TXT record while the CNAME still points at Pages; the certificate is issued in advance. Test the real hostname with `curl --resolve your.cdn.host:443:<endpoint IP>`.
3. Lower the CNAME TTL (e.g. 300 s) at least one old TTL before the switch.
4. Keep Pages running in parallel (every push still deploys there); rollback = CNAME back.
5. Tell customers' IT before the switch: allowlists by GitHub's IPs (`185.199.108–111.153`) stop working, and Front Door has no fixed IPs — allow the FQDN.
