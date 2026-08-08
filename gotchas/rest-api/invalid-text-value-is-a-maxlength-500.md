---
title: "\"Invalid text value\" (HTTP 500) means a Text column hit its 255-character limit"
tags: [rest-api, lists, fields, diagnostics]
applies-to: SharePoint Online
last-reviewed: 2026-08-09
---

# "Invalid text value" (HTTP 500) means a Text column hit its 255-character limit

> **Bottom line.** Writing a string longer than a `Text` column's `MaxLength` fails with a generic HTTP 500 — `Invalid text value. A text field contains invalid data.` The response names **no field**, so in a multi-field write you cannot tell which one broke. Check `TypeAsString`/`MaxLength` before writing, and split the body to find the culprit.
>
> **Ve zkratce.** Zápis řetězce delšího než `MaxLength` u pole typu `Text` skončí obecnou chybou HTTP 500, která **neřekne, které pole** je vinné. Před zápisem ověř typ a limit pole; při chybě rozděl tělo a zapisuj po polích.

## Symptom

A MERGE that had worked for months starts failing after you lengthen one value:

```http
POST /_api/web/lists/getbytitle('Products')/items(1)
X-HTTP-Method: MERGE
IF-MATCH: *
Content-Type: application/json;odata=nometadata

{ "PriceFrom": 1900, "PriceNote": "…450 characters…", "Variants": "[…]", "Specs": "[…]" }
```

```json
{"odata.error":{"code":"-2130575336, Microsoft.SharePoint.SPException",
 "message":{"lang":"en-US","value":"Invalid text value.\n\nA text field contains invalid data. Please check the value and try again."}}}
```

Four fields in the body, one at fault, no hint which. The same payload with a shorter value succeeds.

## Cause

The column was provisioned as **single line of text** (`Text`, `MaxLength` 255), not **multiple lines of text** (`Note`). In the list UI and in an item's JSON the two look identical — the limit only shows up on write, and SharePoint reports it with this catch-all message rather than a field-level validation error.

`Note` fields have no practical `MaxLength` (the property comes back empty), so anything long belongs there.

## Rule

**Check the schema before writing long values:**

```http
GET /_api/web/lists/getbytitle('Products')/fields
    ?$select=InternalName,TypeAsString,MaxLength&$filter=startswith(InternalName,'Price')
```

```json
[{"InternalName":"PriceNote","TypeAsString":"Text","MaxLength":255},
 {"InternalName":"Specs","TypeAsString":"Note","MaxLength":null}]
```

**When the 500 hits in a batched write, bisect.** Send the fields one at a time (or in halves) — the failing one is identified in a couple of requests, versus guessing at four candidates. Worth automating in any provisioning or sync script that writes user-supplied text.

Related trap: the same generic 500 appears for a `Choice` column when the value contains characters the field rejects — so "Invalid text value" is a *length or content* problem in **some** text-ish column, never a transport problem. Don't retry it; the second attempt fails identically.
