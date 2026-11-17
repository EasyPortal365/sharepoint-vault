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

`breakroleinheritance(copyRoleAssignments=true)` copies the web's role assignments onto the object. From then on the object is independent, and changes on the web never reach it. On four sites, the old role survived in three kinds of places:

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
