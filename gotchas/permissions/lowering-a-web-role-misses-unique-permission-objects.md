---
title: "Lowering a group's role on the web does not reach lists that broke inheritance with copied roles"
short-title: Lowering a web role misses unique-permission objects
summary: "`breakroleinheritance(copyRoleAssignments=true)` snapshots the web's role assignments onto the list at that moment; when you later lower a group from Edit to Read on the web, every list or library with unique permissions keeps the old Edit or Full Control. Measure `HasUniqueRoleAssignments` objects too, test the lower account against one of them, and treat a writer exemption as a ceiling, not 'keep everything above the target'"
tags: [permissions, rest-api, site-groups, migration]
applies-to: SharePoint Online
last-reviewed: 2026-11-17
---

# Lowering a group's role on the web does not reach lists that broke inheritance with copied roles

> **Bottom line.** You lower a SharePoint group's role on the web, for example Edit to Read, and read the web's role assignments back to confirm it. That only covers objects that still inherit. Each list or library whose inheritance was broken with `copyRoleAssignments=true` got its own copy of the web's roles at that moment, and it still has the old role. Lowering a role is done only when you have also measured the objects with `HasUniqueRoleAssignments`. Test it under the lower account against one of those objects, not against an inheriting page.
>
> **Ve zkratce.** Snížíte SharePoint skupině roli na webu (třeba z Úprav na Čtení) a novým čtením přiřazení webu to potvrdíte. To platí jen pro objekty, které dědí. Seznam nebo knihovna, u kterých se dědění rozbilo s `copyRoleAssignments=true`, dostaly v tu chvíli vlastní kopii rolí webu a mají starou roli dál. Snížení je hotové až po změření objektů s `HasUniqueRoleAssignments`. Zkoušku pod nižším účtem dělejte na takovém objektu, ne na stránce, která dědí.

## Symptom

A migration lowers an app's group on the web from Edit to Read and verifies it by reading `/_api/web/roleassignments`. A member of that group then edits a page and gets 403, which looks like proof. But updating a document in the site's Documents library still returns 204.

## Cause

`breakroleinheritance(copyRoleAssignments=true)` copies the web's role assignments onto the object. From then on the object keeps its own copy, and changing a group's role on the web does not change it. Microsoft documents one exception: removing a user's permissions is propagated to child objects regardless of inheritance ([Overview of site permissions](https://learn.microsoft.com/sharepoint/sites/overview-of-site-permissions-in-sharepoint-server#about-permission-inheritance)). On four sites, the old role survived in three kinds of places:

- **Lists that an app hardened itself.** The app gives its admin group a "writer" exemption when it trims the copied roles, so the copied Full Control was never removed.
- **The Site Pages library** after another app had narrowed it.
- **Document libraries the site owner had given unique permissions** at some point.

## Measure it

```http
GET /_api/web/lists?$select=Id,Title,HasUniqueRoleAssignments,RootFolder/ServerRelativeUrl
    &$expand=RootFolder&$filter=HasUniqueRoleAssignments eq true&$top=500
GET /_api/web/lists(guid'<id>')/roleassignments
    ?$expand=Member,RoleDefinitionBindings&$select=Member/Title,RoleDefinitionBindings/RoleTypeKind
```

Look for the group's `RoleTypeKind` 6 (Edit) or 5 (Full Control) on these objects. Folders and items can have unique permissions too. Scanning them costs much more, so decide deliberately whether to scan them.

## Rules

1. Lowering a web role is done only after you have also measured the objects with unique permissions.
2. Test under the lower account against an object with unique permissions. An inheriting page that returns 403 proves only the web.
3. An exemption for a writer group means "at most the target level", not "keep anything above the target".
4. You cannot tell a copied role from one the site owner granted on purpose. Whether a migration lowers roles on the customer's own libraries is a product decision. If you do lower them, remove only the role kinds your app used to grant.
5. Reading `roleassignments` on an object with unique permissions needs `EnumeratePermissions` on that object. Of the default levels, only Full Control and Manage Hierarchy include it ([Permission levels in SharePoint](https://learn.microsoft.com/sharepoint/understanding-permission-levels#site-permissions-and-permission-levels)). Full Control on the web does not carry over to an object that no longer inherits. If a member of the group you are lowering runs the migration, it can lower the role but then cannot read the result back (403). Leave the step unverified and let a site owner finish it. Do not mark it done.
6. Hidden system lists (`IWConvertedForms`, `users`, `MaintenanceLogs`) often have unique permissions with no role assignments at all. The read returns 200 with an empty list. Code that removes roles must treat that as unknown. A read-only report can treat it as "the group has nothing here", not as "unreadable".

## One way to fix it

- **Your app's own lists:** cap the admin group at the target level instead of exempting it. Add the target role first, then remove the higher ones, then read the assignments back.
- **Site Pages narrowed by other apps:** lower only your app's groups, before you lower the web. Once the web is lowered, an app admin may no longer be able to manage permissions there. Leave other groups' roles alone.
- **The customer's own libraries:** list them for the site admin with the group's levels and a link to `/_layouts/15/user.aspx?obj={<list id>},doclib&List={<list id>}`. Let the site admin decide.
- **Test it twice:** once as the lowest role that can trigger the migration, and once as a site owner.
