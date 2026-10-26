---
title: Turn a library URL someone pasted into web + library + folder
short-title: Resolve a pasted library URL (web, library, folder)
summary: "`SP.Web.GetWebUrlFromPageUrl`, called on the CURRENT web, resolves the web of any URL in the tenant (other site collections too, 404 for a missing site); strip `Forms/…aspx`, prefer the `?id=` folder, take the first segment under the web as the library, check `BaseTemplate` 101 — all measured from the browser"
tags: [rest-api, libraries, urls, resourcepath, spfx]
applies-to: SharePoint Online REST (browser / SPFx, delegated)
last-reviewed: 2026-10-26
---

# Turn a library URL someone pasted into web + library + folder

> **Bottom line.** Let the admin paste whatever the address bar shows and resolve it yourself: `POST <current web>/_api/SP.Web.GetWebUrlFromPageUrl` with `{ pageFullUrl }` returns the web the URL belongs to — even a web in another site collection — and 404 for a site that does not exist. The library is the first path segment under that web; the rest is a folder.
>
> **Ve zkratce.** Ať správce vloží adresu z prohlížeče, jak je, a rozlož si ji sám: `POST <aktuální web>/_api/SP.Web.GetWebUrlFromPageUrl` s `{ pageFullUrl }` vrátí web, pod který adresa patří – i v jiné kolekci webů – a 404 pro web, který neexistuje. Knihovna je první segment cesty pod webem, zbytek je složka.

**When to reach for it:** a setting like "the library the scanner saves to" or "export target folder". People paste `…/Forms/AllItems.aspx`, a URL with the opened folder in `?id=`, or a direct link (`/:f:/r/<path>` — measured: it redirects to that same path). Asking them for "server-relative URL of the library" fails; parsing it yourself works. A sharing link with a token (`/:f:/s/<token>`, `/:f:/g/…`) does not contain the path at all — refuse it and ask for the address bar URL.

## Measured (SharePoint Online, 26 October 2026, browser `fetch`)

| `pageFullUrl` sent to `<this web>/_api/SP.Web.GetWebUrlFromPageUrl` | Result |
|---|---|
| `…/sites/a/Shared Documents/Forms/AllItems.aspx` (same web) | 200 `{"value":"https://tenant.sharepoint.com/sites/a"}` |
| `https://tenant.sharepoint.com/Shared Documents/Forms/AllItems.aspx` (root site, another site collection) | 200 `{"value":"https://tenant.sharepoint.com"}` |
| `…/sites/a/Skeny%20test/Forms/AllItems.aspx?id=1` (library that does not exist yet) | 200 — resolves the **web**, says nothing about the library |
| `…/sites/does-not-exist/Docs` | 404 `File Not Found.` |

It needs a request digest of the web you POST to; a digest from another site collection answers 403 "security validation … is invalid".

## Code

```ts
/** OData string literal for a URL path: double apostrophes, then encode (# and % survive). */
const lit = (p: string) => "'" + encodeURIComponent(p.split("'").join("''")) + "'";

function parsePasted(input: string, origin: string): { absolute: string; path: string } | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.origin.toLowerCase() !== origin.toLowerCase()) return null;
  if (/^\/:[a-z]:\/(?!r\/)/i.test(u.pathname)) return null;  // token sharing link: no path in it
  const id = u.searchParams.get('id');                       // opened folder, already decoded
  let path = id && id.startsWith('/') ? id : decodeURIComponent(u.pathname);
  path = path.replace(/^\/:[a-z]:\/r(?=\/)/i, '')           // direct link prefix
             .replace(/\/Forms\/[^/]*$/i, '').replace(/\/[^/]+\.aspx$/i, '').replace(/\/+$/, '');
  if (!path) return null;
  // encode per segment, so a '#' in a folder name does not become a fragment
  return { absolute: u.origin + path.split('/').map(encodeURIComponent).join('/'), path };
}

async function resolveLibrary(currentWeb: string, pasted: string, digest: string) {
  const origin = new URL(currentWeb).origin;
  const p = parsePasted(pasted, origin);
  if (!p) throw new Error('Not a SharePoint URL in this tenant');
  const r = await fetch(`${currentWeb}/_api/SP.Web.GetWebUrlFromPageUrl`, {
    method: 'POST',
    headers: { Accept: 'application/json;odata=nometadata', 'Content-Type': 'application/json;odata=nometadata', 'X-RequestDigest': digest },
    body: JSON.stringify({ pageFullUrl: p.absolute })
  });
  if (!r.ok) throw new Error(r.status === 404 ? 'Site not found or no access' : 'HTTP ' + r.status);
  const webUrl = (await r.json()).value.replace(/\/$/, '');
  const webPath = new URL(webUrl).pathname.replace(/\/$/, '');
  const rest = p.path.slice(webPath.length + 1).split('/').filter(Boolean);
  if (!rest.length) throw new Error('The URL points at the site, not a library');
  const libraryPath = webPath + '/' + rest[0];               // document libraries sit directly under the web
  const list = await fetch(`${webUrl}/_api/web/GetList(@l)?$select=Title,BaseTemplate&@l=${lit(libraryPath)}`,
    { headers: { Accept: 'application/json;odata=nometadata' } }).then((x) => x.ok ? x.json() : null);
  if (!list) throw new Error('Library not found or no access');
  if (list.BaseTemplate !== 101) throw new Error(`"${list.Title}" is not a document library`);
  return { webUrl, libraryPath, folder: rest.slice(1).join('/'), title: list.Title };
}
```

## Notes

- `GetWebUrlFromPageUrl` only finds the **web**. A typo in the library name still resolves — `GetList` is what proves the library exists, and `BaseTemplate` 101 that it is a document library (a list URL would otherwise pass).
- "First segment under the web" assumes the library's root folder sits directly under the web, which is where the UI creates document libraries (lists go under `/Lists/`). If that assumption does not hold for some URL, `GetList` on the guessed path fails and you report it instead of guessing.
- Read and write the folder with the ResourcePath API (`GetFolderByServerRelativePath(decodedurl=…)`, `MoveToUsingPath`) — a pasted path is exactly where `#` and `%` show up: [A `#` or `%` in a file or folder name](../../gotchas/rest-api/hash-and-percent-in-file-names-need-the-resourcepath-api.md).
- Measured the same evening: a file moved with `MoveToUsingPath(DecodedUrl=…,moveOperations=0)` into a subfolder of the same library keeps its `UniqueId`, so a key built from `UniqueId` still matches after the move; `moveOperations=0` on an existing target name fails instead of overwriting.
- If the pasted URL can point at your own app's storage, compare `libraryPath` with it and refuse — otherwise the app reads what it just wrote.
