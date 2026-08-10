---
title: A library your app provisions inherits the web's write permissions — and that is how an AI grounding source gets poisoned
tags: [security, provisioning, libraries, search, rag, permissions]
applies-to: SharePoint Online
last-reviewed: 2026-08-10
---

# A library your app provisions inherits the web's write permissions

> **Bottom line.** Provisioning helpers set item-level permissions on **lists**; document **libraries** usually get none, so they inherit the web. Any member with Contribute can upload straight over REST. When that library is what an AI assistant reads as "company knowledge", uploading a file is the same as editing the answers.
>
> **Ve zkratce.** Knihovny z provisioningu obvykle nedostanou žádná oprávnění a dědí je z webu — člen s Přispívat tam nahraje cokoli. Když z knihovny čte AI, je to cesta, jak jí podstrčit „firemní pravdu".

## Symptom

There is none, which is the point. Everything works; the library simply accepts writes from more people than the product's UI suggests. You discover it by asking the question, not by hitting an error.

The consequence has a shape though: an assistant grounded on that library starts citing a document nobody in the content team wrote, with the confident tone reserved for internal sources.

## Cause

Two habits meeting:

1. **Library definitions carry fewer settings than list definitions.** Provisioning code that faithfully applies `ReadSecurity`/`WriteSecurity` to lists often has no equivalent path for libraries — the settings are simply never sent, so the library keeps the web's inheritance.
2. **The app's own gate is UI.** "Only administrators can publish" is enforced by which buttons render. `POST /_api/web/GetFolderByServerRelativeUrl('…')/Files/add(...)` does not consult your React tree.

## The fix that looks right and mostly is not

The obvious move is `WriteSecurity: 4` on the library — *create and edit: none*. It is one PATCH, it reads back cleanly, and it is **almost useless on a team site**.

Item-level permissions are bypassed by anyone holding **Manage Lists** — and that is not just owners. Measured on a real site:

```
Members  [Edit] -> bypasses the setting      Visitors [Read] -> setting applies
Manage Lists:  Full Control ✅  Design ✅  Edit ✅  |  Contribute ❌  Read ❌
```

The built-in **Edit** level includes Manage Lists, and Edit is what the default **Members** group gets on a modern team site. So `WriteSecurity: 4` stops users with **Contribute** and nobody else — while the ordinary member you were worried about uploads happily.

**The only boundary that holds is unique permissions on the library:**

```
POST /_api/web/GetList('<serverRelLibUrl>')/breakroleinheritance(copyRoleAssignments=false,clearSubscopes=true)
POST /_api/web/GetList('<serverRelLibUrl>')/roleassignments/addroleassignment(principalid=<group>,roleDefId=<def>)
```

Writers (the publishing/approver groups) get Contribute or higher; everyone else gets Read. Keep `WriteSecurity: 4` as defence in depth if you like, but do not count it as the control.

### Verifying Manage Lists without guessing

```
GET /_api/web/roledefinitions?$select=Name,BasePermissions
```

Manage Lists is **bit 11 (`0x800`)** of `BasePermissions.Low`. Do not derive the bit from the `PermissionKind` value (that tempts you into `1 << 12`, which is `viewFormPages`). Derive it from the **difference between Edit and Contribute** — two levels that differ precisely by Manage Lists — and sanity-check the result: Read must come out **false**, Full Control **true**. A calculation claiming "Read has Manage Lists" is telling you the mask is wrong, not that SharePoint is odd.

## Making the setting stick at all

Whichever control you choose, the write itself needs care:

**1. Do it outside the version-gated provisioning block.** Schema-version gates return early once the version matches. If the first person to open the upgraded app is a plain member, the `PATCH` fails with `403`, the version is still recorded, and the setting is never applied again. Use a dedicated post-provisioning step with its **own marker** (per user + web + step revision).

**2. Read first, patch only the difference.** Cheap, and it stops members generating a `403` on every page load:

```ts
const info = await get(`${web}/_api/web/GetList('${serverRelLibUrl}')?$select=WriteSecurity`);
if (info.WriteSecurity !== 4) {
  const r = await fetchApi(`${web}/_api/web/GetList('${serverRelLibUrl}')`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'IF-MATCH': '*' },
    body: JSON.stringify({ '@odata.type': '#SP.List', WriteSecurity: 4 })
  });
  settled = r.ok || r.status === 403;   // 403 = this user simply cannot; do not retry forever
}
```

Treat `403` as "done for this user" (their marker is their own) but a `5xx` as "try again next load".

**3. Do not reach for `NoCrawl` instead.** Excluding the library from the search index is a different axis: it does not stop anyone writing, and it *does* stop the assistant (and tenant search) from finding legitimate content. Search trims results by the asking user's permissions anyway.

## "It is set" and "it excludes someone" are different claims

The trap this page exists for: it is easy to PATCH `WriteSecurity: 4`, read it back over REST, see `4`, and write "library locked" in the release notes. That proves the value is **stored**. Whether anyone is actually **excluded** depends on which permission levels the site's groups hold — which is a different query entirely:

```
GET /_api/web/roleassignments?$expand=Member,RoleDefinitionBindings
    &$select=Member/Title,RoleDefinitionBindings/Name
```

Cross that list with the Manage Lists check above. If every group that can already add files holds Edit or higher, the setting excludes nobody and the control is decorative.

Note also that you cannot test enforcement from an owner account: Full Control bypasses item-level permissions by design, so "I could still upload" tells you nothing. Either sign in as a Contribute-level user, or check effective permissions for a specific person without their password:

```
GET /_api/web/getusereffectivepermissions(@u)?@u='i:0%23.f|membership|user@company.com'
```

Until you have observed a non-Manage-Lists user being refused, it is a measure, not a proven control — worth a line in your tech-debt list.

## Related

- Item-level permission settings on a provisioned list — defaults, and reconciling them after the fact.
- `NoCrawl` on a library silently blinds your RAG.
- An image upload that accepts `image/*` accepts SVG.
