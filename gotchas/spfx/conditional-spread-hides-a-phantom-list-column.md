---
title: A conditional spread hides a phantom column until SharePoint returns 400
tags: [spfx, typescript, react, rest-api, lists]
applies-to: SharePoint Online, SPFx, any TypeScript client writing list items
last-reviewed: 2026-08-12
---

# A conditional spread hides a phantom column until SharePoint returns 400

> **Bottom line.** TypeScript's excess-property check only fires on a *direct* object literal, so `...(cond ? { Ghost: 1 } : {})` smuggles a field that your list doesn't have all the way into the POST — where SharePoint answers `HTTP 400 … property does not exist on type 'SP.Data.<List>ListItem'`. Add optional fields directly, not through a conditional spread.
>
> **Ve zkratce.** Kontrola nadbytečných vlastností v TypeScriptu se spustí jen u *přímého* objektového literálu, takže `...(cond ? { Ghost: 1 } : {})` propašuje pole, které list nemá, až do POSTu – a SharePoint odpoví `HTTP 400 … property does not exist on type 'SP.Data.<List>ListItem'`. Volitelná pole doplňuj napřímo, ne podmíněným spreadem.

## Symptom

Saving an item fails with a message that names a column you are sure you never added:

```
SP POST https://contoso.sharepoint.com/sites/projects/_api/web/GetList(@l)/items?@l='/sites/projects/lists/Contacts':
HTTP 400 – {"error":{"code":"-1, Microsoft.SharePoint.Client.InvalidClientQueryException",
"message":"The property 'CompanyId' does not exist on type 'SP.Data.ContactsListItem'.
Make sure to only use property names that are defined by the type."}}
```

`tsc --noEmit` and ESLint are both clean, and the same field works fine on a neighbouring list.

## Cause

The form seeds its state through a conditional spread:

```ts
interface IContact { Title: string; Company: string; /* no CompanyId! */ }

const [form, setForm] = useState<Partial<IContact>>(() => ({
  Source: 'Web',
  ...(initialCompany ? { CompanyId: initialCompany.id, Company: initialCompany.name } : {})
}));                    // ^ CompanyId is not in IContact — and TypeScript says nothing
```

Excess-property checking is a **freshness** rule: it applies to an object literal assigned
straight into a typed position. `...(cond ? {…} : {})` is a spread of an *expression*, so the
literal loses its freshness and the extra key passes compilation. The whole form object is later
handed to the create call, so the phantom key reaches SharePoint verbatim.

Two things make this survive review:

- The neighbouring entity really does have the column (`Deals` has `CompanyId`, `Contacts`
  links to a company **by name**), so the pattern was copy-pasted from working code.
- The path is a *secondary* route to the same feature — "new contact **from the company panel**"
  rather than "new contact from the list" — so nobody exercised it. `git log -S` on the offending
  line showed it had shipped months earlier and had never once worked.

## Fix

Add the optional field **directly**, so it is part of a fresh literal and the check fires:

```ts
const [form, setForm] = useState<Partial<IContact>>(() => ({
  Source: 'Web',
  Company: initialCompany ? initialCompany.name : ''     // compile error if Company is not on IContact
}));
```

If you genuinely need the spread, annotate it so the type is checked at the spread site:

```ts
...(cond ? { Company: name } as Partial<IContact> : {})
```

## Catch the rest of them with a script

One instance is never the only one. Two cheap mechanical passes over the repo find the family:

1. **Contract diff** — parse the provisioning manifest into `list → Set(columns)` and the
   interfaces into `type → Set(fields)`, then report the difference both ways. Fields in the
   interface but not the list are 400s waiting to happen; columns with no field are dead weight.
2. **Object-key sweep** — collect every prefixed identifier used as an *object key*
   (`/\bMyPrefix[A-Za-z0-9]*(?=\s*:)/`) across all `.ts`/`.tsx` files and report anything that is
   not a column of any list nor a known settings key. This one catches the cases that bypassed the
   contract, which is exactly what a conditional spread does.

Both take minutes to write and belong in any broad audit of an SPFx app.

## Notes

- The same blind spot applies to `Object.assign(target, cond && {...})` and to any payload built
  by merging partials — prefer one explicit literal per write path.
- Related: [`__metadata` body requires verbose](../rest-api/metadata-body-requires-verbose.md) —
  the other common source of "property does not exist" style 400s on writes.
- When a bug report sounds like "but this must have worked", check `git log -S` on the offending
  line before hunting for a regression. A secondary path to a feature is more often born broken
  than broken later.
