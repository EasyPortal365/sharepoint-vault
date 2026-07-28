---
title: GetStorageEntity returns 200 for a missing key, not 404
tags: [rest-api, tenant-properties, spfx, configuration]
applies-to: SharePoint Online
last-reviewed: 2026-07-28
---

# `GetStorageEntity` returns 200 for a missing key, not 404

> **Bottom line.** A tenant property that was never set answers `HTTP 200 {"odata.null":true}`, so status codes cannot tell "not configured" apart from "read failed" — and writing one needs Tenant Admin, so an app can never provision its own.
>
> **Ve zkratce.** Nenastavená tenant property vrací `HTTP 200 {"odata.null":true}`, takže podle status kódu nerozliš��š „není nakonfigurováno" od „čtení selhalo" – a zápis vyžaduje Tenant Admin, takže si aplikace vlastní property nikdy nezaloží sama.

## Symptom

Two failure modes, both quiet:

1. Code treats a missing tenant property as an error (or an error as a missing property) and then writes defaults over real configuration.
2. An app tries to store its own settings in a tenant property and gets **403 Forbidden** at runtime — only from non-admin users, so it passes every test the developer runs.

## Cause

Reading is permissive, writing is not:

```
GET /_api/web/GetStorageEntity('neverSetKey')
→ HTTP 200
   {"odata.null":true}
```

The read works from **any site collection** in the tenant, for ordinary users. There is no 404 for an unset key — the request succeeded, the value is simply null. So `response.ok` is true in all three of these cases:

| Situation | Status | Body |
|---|---|---|
| Key set | 200 | `{"Value":"…","Comment":null,"Description":null}` |
| Key never set | 200 | `{"odata.null":true}` |
| Transient service issue | 5xx | (error) |

Writing (`SetStorageEntity`) requires **Tenant Admin**, which is why it returns 403 when called from a web part running as a normal user.

## Fix

Distinguish the three states from the **body**, never from the status code:

```ts
type TenantProp =
  | { state: 'set'; value: string }
  | { state: 'not-configured' }
  | { state: 'error'; detail: string };

async function readTenantProperty(webUrl: string, key: string): Promise<TenantProp> {
  try {
    const res = await fetch(`${webUrl}/_api/web/GetStorageEntity('${key.replace(/'/g, "''")}')`, {
      headers: { Accept: 'application/json;odata=nometadata' }
    });
    if (!res.ok) return { state: 'error', detail: `HTTP ${res.status}` };
    const body = await res.json();
    // The whole point: 200 + odata.null means "never set", NOT a failure.
    if (!body || body['odata.null'] === true || body.Value == null) return { state: 'not-configured' };
    return { state: 'set', value: body.Value };
  } catch (e) {
    return { state: 'error', detail: (e as Error).message };
  }
}
```

Collapsing `not-configured` and `error` into one nullish value is how "read failed" silently becomes "user has no settings" — and the next save writes defaults over whatever was really there.

Note the doubled apostrophe: `encodeURIComponent` does **not** escape `'` inside an OData string literal, so a key containing one breaks the call unless you double it first.

## Part of a wider pattern

SharePoint's `GetByX`-style accessors are unreliable about signalling "this object does not exist", and each one picks a different code:

| Call | Missing object returns |
|---|---|
| `GetStorageEntity('key')` | **200** + `{"odata.null":true}` |
| [`fields/getbyinternalnameortitle('X')`](getbyinternalnameortitle-400-not-404.md) | **400** `ArgumentException` |
| `sitegroups/getbyname('X')` | **500** |

So an existence check written as `if (status !== 404) { fail }` is wrong in every one of these cases. Either inspect the body, or skip the check entirely and let the create call give you the definitive answer.

## Design consequence

Because provisioning a tenant property needs Tenant Admin, it cannot back any feature whose onboarding story is *"just deploy the package"*. A tenant property is a fine place for something an administrator deliberately configures once; it is a poor place for anything the app must find on first run.
