---
title: View formatting JSON can't contain `<` or `&` — XmlException on save
tags: [lists, column-formatting, view-formatting, pnp-powershell, csom, rest-api]
applies-to: SharePoint Online
last-reviewed: 2026-07-25
---

# View formatting JSON can't contain `<` or `&` — XmlException on save

> **Bottom line.** A view's `CustomFormatter` is stored inside the view's schema XML, so a raw `<` or `&` anywhere in the JSON kills the save with a server-side `XmlException` — write comparisons the other way round (`@now > [$Field]`) and nest `if()` instead of using `&&`.
>
> **Ve zkratce.** `CustomFormatter` u zobrazení se ukládá dovnitř XML schématu view, takže syrový `<` nebo `&` kdekoli v JSON shodí uložení serverovou výjimkou `XmlException` – porovnání proto piš obráceně (`@now > [$Field]`) a místo `&&` vnořuj `if()`.

## Symptom

Saving view formatting fails, and the character offset points into your JSON:

```text
An error occurred while parsing EntityName. Line 3, position 53.
```

```text
Name cannot begin with the ' ' character, hexadecimal value 0x20. Line 3, position 218.
```

The first one lands exactly on an `&&`, the second exactly on a `<` followed by a space. The same JSON is accepted by the *Format current view* pane in the browser, which quietly escapes it for you.

It fails identically on all three write paths — this is not a PnP bug:

```powershell
# PnP
Set-PnPView -List $listId -Identity 'All Documents' -Values @{ CustomFormatter = $json }

# CSOM
$view.CustomFormatter = $json; $view.Update(); $ctx.ExecuteQuery()

# REST
Invoke-PnPSPRestMethod -Method Merge `
  -Url "/_api/web/lists(guid'$listId')/views('$viewId')" `
  -Content @{ CustomFormatter = $json }
```

REST returns the server's own verdict:

```json
{"odata.error":{"code":"-1, System.Xml.XmlException","message":{"lang":"en-US",
"value":"Name cannot begin with the ' ' character, hexadecimal value 0x20. Line 3, position 218."}}}
```

## Cause

View formatting is persisted as an element **inside the view's schema XML**, not as a standalone JSON property. When the server re-serializes that schema, an unescaped `<` opens what looks like a new element (`< @now` → "a name starting with a space") and a bare `&` starts an entity reference that never resolves (`&& [$Field]` → "parsing EntityName").

**Column** formatting is not affected — `CustomFormatter` on a *field* accepts `<` and `&&` without complaint. Only views go through the XML round-trip, which is why the same expression works in a column formatter and fails in a row formatter.

## Fix

Keep the JSON free of both characters. Neither restriction costs you any expressiveness.

Flip the comparison so only `>` appears — `>` needs no escaping in XML text:

```jsonc
// fails: raw '<'
"additionalRowClass": "=if([$ReviewDate] < @now, 'sp-css-backgroundColor-errorBackground', '')"

// works: same logic, reversed
"additionalRowClass": "=if(@now > [$ReviewDate], 'sp-css-backgroundColor-errorBackground', '')"
```

Replace `&&` with nested `if()`:

```jsonc
// fails: raw '&'
"=if([$ReviewDate] != '' && @now > [$ReviewDate], 'overdue', '')"

// works
"=if([$ReviewDate] == '', '', if(@now > [$ReviewDate], 'overdue', ''))"
```

Catch it before the round-trip instead of decoding offsets afterwards:

```powershell
if ($json -match '[<&]') {
    throw "$file contains '<' or '&' — SharePoint will not store this view formatter."
}
```

## Notes

- `>` and `>=` are safe. `<`, `<=`, `&&` are not. `||` is fine — only `&` is special.
- The browser's *Format current view* pane escapes the JSON on the way in, so a formatter pasted there and a formatter deployed by script are **not** interchangeable. Anything you plan to provision must be authored under this restriction.
- Round-tripping confirms it: read a view formatter back after saving it through the UI and you get the escaped form, not what you typed.
- Same trap applies to tile/gallery formatting — it's still view formatting.
- Related: [Get lists by URL, not by title](../rest-api/get-list-by-url-not-by-title.md).
