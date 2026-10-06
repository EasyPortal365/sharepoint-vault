---
title: Contribute on the web lets a role edit and delete the pages of the site — including the page your app lives on
short-title: Contribute on the web can edit and delete site pages
summary: Modern pages are items in the Site Pages library, which inherits from the web, so a group you give Contribute on the web "so it can write list items" can also edit and delete every page; withholding Manage Lists does not help — break inheritance on Site Pages and give app roles Read there
tags: [permissions, site-pages, contribute, effective-permissions, hardening]
applies-to: SharePoint Online — any site where business roles get Contribute (or Edit) on the web itself rather than only on the lists they write to
last-reviewed: 2026-10-06
---

# Contribute on the web lets a role edit and delete the pages of the site — including the page your app lives on

> **Bottom line.** A modern page is just an item in the **Site Pages** library, and that library inherits permissions from the web. Give a group **Contribute** on the web so that it can add items to your lists, and it can also add, edit and delete every page of the site — the home page that hosts your app included. Taking **Manage Lists** away (Contribute instead of Edit) does not change that: editing a page needs only item rights. If the role should write data but not pages, break inheritance on Site Pages and give the role **Read** there, then measure it.
>
> **Ve zkratce.** Moderní stránka je obyčejná položka knihovny **Stránky webu** a ta dědí oprávnění z webu. Dáte-li skupině na webu **Přispívat**, aby mohla zapisovat do vašich seznamů, může zároveň přidávat, upravovat i mazat všechny stránky webu – včetně té, na které běží vaše aplikace. Odebrání **Spravovat seznamy** (Přispívat místo Úprav) na tom nic nemění: k úpravě stránky stačí práva k položkám. Má-li role zapisovat data, ale ne stránky, zrušte u Stránek webu dědění, dejte jí tam **Čtení** a změřte to.

## Symptom

You tighten a role from Edit to Contribute so that it can no longer change list settings or columns, measure it, and Manage Lists is gone everywhere — so you describe the role as "writes items only, cannot change lists, columns or pages". The first two are true. The third is not:

```js
// As a member of the role — ask SharePoint, not the app
const p = await (await fetch(
  `${web}/_api/web/GetList('${serverRelativeWeb}/SitePages')/EffectiveBasePermissions`,
  { headers: { Accept: 'application/json;odata=nometadata' } })).json();
const low = Number(p.Low);
({ add: !!(low & 0x2), edit: !!(low & 0x4), del: !!(low & 0x8), manageLists: !!(low & 0x800) });
// → { add: true, edit: true, del: true, manageLists: false }
```

Add, edit and delete are all granted on Site Pages. The role can open the page that hosts your app, edit it, remove the web part, or delete the page outright.

## Cause

- Modern pages are list items in the `SitePages` library. Editing or deleting one is governed by **EditListItems** and **DeleteListItems**, not by Manage Lists or Add and Customize Pages.
- `SitePages` inherits from the web unless someone broke inheritance. A group that holds Contribute on the web therefore holds Contribute on Site Pages too.
- Contribute (`RoleTypeKind` 3) carries add, edit and delete of items. Read (`RoleTypeKind` 2) carries none of them.

The usual reason a role gets Contribute on the web is convenience: one assignment and every list the app creates later "just works". The pages come along for free.

## Fix

Keep the web-level assignment if your lists rely on it, and narrow only Site Pages:

```js
// RoleTypeKind: 2 Reader · 3 Contributor · 6 Editor — role names are localised, resolve by type
const reader = await get(`${web}/_api/web/roledefinitions/getbytype(2)?$select=Id`);
const pages = `${web}/_api/web/GetList('${serverRelativeWeb}/SitePages')`;

// Copy, so site owners and everyone else keep what they had; then narrow the app roles
await post(`${pages}/breakroleinheritance(copyRoleAssignments=true,clearSubscopes=false)`);
for (const groupId of appRoleGroupIds) {
  await post(`${pages}/roleassignments/removeroleassignment(principalid=${groupId})`);
  await post(`${pages}/roleassignments/addroleassignment(principalid=${groupId},roledefid=${reader.Id})`);
}
```

- **Copy the assignments here.** You are not hiding the pages, only taking writing away from some groups; dropping the copied assignments would take reading away from everyone else, and the app page would stop opening.
- **Check the default Members group as well.** On a team site the Members group has Edit on the web and so on Site Pages. Whether that is acceptable is a governance decision, not a side effect to leave in place unnoticed.
- **Verify by reading the state back**: `roleassignments` on Site Pages, then `EffectiveBasePermissions` as a member of each role — and confirm the role can still *open* the page with the app.
- These calls need Manage Permissions. Run them from your provisioning step under an owner, and never record "done" on the strength of a 200 alone.

## Say it accurately in the UI and in release notes

Until the library is narrowed, describe the role by what was measured: "cannot change list settings or columns". Do not add "or pages" because the role lost Manage Lists — that is exactly the inference this note is about.

## See also

- [WriteSecurity 4 needs Manage Lists](write-security-4-needs-managelists.md) — the opposite direction: when Contribute is not enough
- [Effective permissions ignore security groups](effective-permissions-ignore-security-groups.md) — measure as a member of the role, not by asking about another user
