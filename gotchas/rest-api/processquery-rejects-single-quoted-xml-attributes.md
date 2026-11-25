---
title: "ProcessQuery answers `Invalid request.` when the XML uses single-quoted attributes"
short-title: ProcessQuery needs double-quoted attributes
summary: "CSOM's `/_vti_bin/client.svc/ProcessQuery` accepts only `Name=\"value\"`. The same payload with `Name='value'` — still well-formed XML — comes back as HTTP 200 with `ErrorMessage: Invalid request.` and no hint about the cause"
tags: [rest-api, csom, error-handling, diagnostics]
applies-to: SharePoint Online, CSOM over `/_vti_bin/client.svc/ProcessQuery`
last-reviewed: 2026-11-25
---

# ProcessQuery answers `Invalid request.` when the XML uses single-quoted attributes

> **Bottom line.** Build CSOM request XML with double quotes around every attribute value. Single quotes are perfectly good XML and the natural choice inside a JavaScript string literal, but the ProcessQuery parser rejects them with HTTP 200 and a bare `Invalid request.` that points at nothing.
>
> **Ve zkratce.** XML pro CSOM piš s dvojitými uvozovkami u všech atributů. Jednoduché uvozovky jsou platné XML a v řetězci v JavaScriptu se nabízejí samy, jenže parser ProcessQuery je odmítne – vrátí HTTP 200 a holé `Invalid request.`, které neukazuje na nic konkrétního.

## Symptom

A `ProcessQuery` call returns HTTP 200 and this body:

```json
[{"SchemaVersion":"15.0.0.0","LibraryVersion":"16.0.27911.12005","ErrorInfo":{
  "ErrorMessage":"Invalid request.","ErrorValue":null,
  "TraceCorrelationId":"00000000-0000-0000-0000-000000000000","ErrorCode":-1,
  "ErrorTypeName":"Microsoft.SharePoint.Client.ClientServiceException"},
  "TraceCorrelationId":"00000000-0000-0000-0000-000000000000"}]
```

No action id, no object path id, no property name. The same request body copied into a file validates as XML.

## Cause

The server-side parser for the client query protocol accepts attribute values in double quotes only. Written from JavaScript, single quotes are the obvious choice, because they let the XML keep its own double quotes:

```js
// rejected
const xml = '<Method Name=\'Update\' Id=\'12\' ObjectPathId=\'3\' />';
```

The payload travels fine, the endpoint answers 200, and the failure arrives as a generic `ClientServiceException` inside the body.

## Fix

Keep the double quotes in the XML and quote the JavaScript string differently:

```js
// accepted
const xml = '<Method Name="Update" Id="12" ObjectPathId="3" />';
```

Measured A/B on SharePoint Online, same node, same payload, only the quote character swapped, three calls in a row:

| Attribute quoting | HTTP | `ErrorInfo` |
|---|---|---|
| `'single'` | 200 | `Invalid request.` |
| `"double"` | 200 | `null` — the change is applied |
| `'single'` again | 200 | `Invalid request.` |

## Notes

- CSOM reports failures inside an HTTP 200 body. Parse the response array and check `ErrorInfo` on every element; a status check alone reports success for every one of these.
- `Invalid request.` is the parser's generic answer and does not name the quoting specifically — only the A/B above ties it to that. If double quotes do not clear it, look at the object-path graph next: every `Id` has to be unique across `<Actions>` and `<ObjectPaths>`, and every `ObjectPathId` has to point at an `Id` that the same request declares.
- Escape the values themselves (`&`, `<`, `>`, `"`) before you paste them into the XML — a title with an ampersand produces a different error, from the XML reader rather than from the client service.
