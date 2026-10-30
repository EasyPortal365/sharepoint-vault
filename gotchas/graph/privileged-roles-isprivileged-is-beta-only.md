---
title: Which Entra ID roles are privileged? `isPrivileged` is beta-only, and a hand-written list gets it wrong
short-title: isPrivileged is beta-only
summary: "Read `isPrivileged` live from beta `roleDefinitions` – v1.0 omits it and 400s on `$select=isPrivileged`; Exchange/SharePoint/Teams admins are not privileged"
tags: [graph, entra-id, directory-roles, security, beta]
applies-to: "Microsoft Graph roleManagement/directory/roleDefinitions (v1.0 and beta), delegated Directory.Read.All"
last-reviewed: 2026-10-30
---

# Which Entra ID roles are privileged? `isPrivileged` is beta-only

> **Bottom line.** Microsoft flags its privileged built-in roles with `isPrivileged` on the role definition, but only the **beta** endpoint returns that property. v1.0 leaves it out, and asking for it there with `$select=isPrivileged` answers **400**. Read beta and filter in code. Don't hard-code the list from memory: in our measurement, 5 of the 24 roles in a list written from experience were not privileged at all, and it missed several that are. Exchange, SharePoint and Teams Administrator are **not** privileged; Global Reader, Security Reader and Application Developer **are**.
>
> **Ve zkratce.** Privilegované vestavěné role Microsoft označuje vlastností `isPrivileged`, ale vrací ji jen **beta** endpoint. v1.0 ji vynechá a dotaz `$select=isPrivileged` tam skončí **400**. Čtěte beta a filtrujte v kódu. Seznam nepište zpaměti: 5 z 24 rolí v seznamu sepsaném podle zkušenosti vůbec privilegovaných nebylo a několik privilegovaných chybělo. Správce Exchange, SharePointu a Teams privilegovaní **nejsou**; Global Reader, Security Reader a Application Developer **jsou**.

## Symptom

A security report counts "holders of privileged roles" and flags guests who hold one. The list of privileged role template IDs is hard-coded and looks reasonable, but the numbers disagree with the "Privileged" label in the Entra admin center.

## Cause

Measured on 30 October 2026 with a delegated token (`Directory.Read.All`):

| Request | Result |
|---|---|
| `GET /v1.0/roleManagement/directory/roleDefinitions` | `200`, 145 roles, no `isPrivileged` on any of them |
| `GET /v1.0/roleManagement/directory/roleDefinitions?$select=id,isPrivileged` | `400 BadRequest` |
| `GET /beta/roleManagement/directory/roleDefinitions` | `200`, `isPrivileged` present – 35 built-in roles `true` |
| `GET /beta/roleManagement/directory/roleDefinitions?$select=id,templateId,isPrivileged` | `200`, same 35 |

Comparing the live flags with our list written from experience:

- **Not privileged** (although our list had them): Exchange Administrator, SharePoint Administrator, Teams Administrator, Authentication Policy Administrator, Microsoft Entra Joined Device Local Administrator (formerly Azure AD Joined Device Local Administrator).
- **Privileged** (our list missed them): among others Global Reader, Security Reader, Application Developer, AI Administrator, AI Reader and Agent ID Administrator. Not every new AI role is privileged – Agent ID Developer and Agent Registry Administrator are not.

Microsoft keeps adding roles, and the privileged label itself is still in preview, so any fixed list goes stale.

## Fix

Read the flag at scan time, and keep a dated fallback only for when the beta call fails:

```ts
async function privilegedRoleIds(client: MSGraphClientV3): Promise<string[]> {
  try {
    // beta only – v1.0 does not return isPrivileged.
    const r = await client.api('/roleManagement/directory/roleDefinitions').version('beta').get();
    const ids = (r.value || [])
      .filter((d: any) => d.isPrivileged === true && d.isBuiltIn !== false && d.templateId)
      .map((d: any) => String(d.templateId).toLowerCase());
    return ids.length ? ids : FALLBACK_PRIVILEGED; // measured list, with its date in a comment
  } catch {
    return FALLBACK_PRIVILEGED;
  }
}
```

Match role assignments by `roleDefinitionId` against these template IDs (for built-in roles, Microsoft's examples show the definition `id` equal to `templateId`). Beta also documents `$filter=isPrivileged eq true` (we did not measure it), and the least privileged permission for reading role definitions is `RoleManagement.Read.Directory` – `Directory.Read.All` works too.

## See also

- [Microsoft Entra built-in roles – privileged roles](https://learn.microsoft.com/entra/identity/role-based-access-control/permissions-reference)
- [Privileged roles and permissions in Microsoft Entra ID](https://learn.microsoft.com/entra/identity/role-based-access-control/privileged-roles-permissions)
- [unifiedRoleDefinition resource type (beta)](https://learn.microsoft.com/graph/api/resources/unifiedroledefinition?view=graph-rest-beta)
