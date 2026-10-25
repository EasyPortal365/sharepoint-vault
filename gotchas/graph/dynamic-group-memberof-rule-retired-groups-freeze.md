---
title: The memberOf operator in dynamic group rules stops working on 3 November 2026 — groups freeze instead of failing
short-title: "Dynamic `memberOf` rules freeze after 3 Nov 2026"
summary: "Entra ends the `memberOf` preview operator in dynamic membership rules on 3 Nov 2026 (MC1448379): affected groups, dynamic admin units and auto-assignment policies keep their last membership and never update again. Offboarding tools that skip dynamic groups leave departed users inside them. The Graph `/memberOf` endpoints are not affected."
tags: [graph, groups, dynamic-membership, entra-id, offboarding, governance]
applies-to: Microsoft Entra ID dynamic membership groups, dynamic administrative units, entitlement management auto-assignment policies
last-reviewed: 2026-10-25
---

# Dynamic `memberOf` rules freeze after 3 November 2026

> **Bottom line.** A dynamic group whose rule is `user.memberOf -any (group.objectId -in [...])` stops being re-evaluated on **3 November 2026** (Message Center MC1448379). Nothing errors and nobody is removed — the group simply **keeps its last membership forever**. Any tool that skips dynamic groups during offboarding (you cannot remove a member from a dynamic group via Graph) now leaves the departed user in the frozen group, with whatever Teams, SharePoint, licence or Conditional Access scope it carries. Find these rules, replace them with attribute-based conditions or convert the group to assigned membership.
>
> **Ve zkratce.** Dynamická skupina s pravidlem `user.memberOf -any (...)` se od **3. 11. 2026** přestane přepočítávat (MC1448379). Nic nespadne a nikdo nevypadne – skupina si **navždy ponechá poslední členy**. Nástroj, který při offboardingu dynamické skupiny přeskakuje (ručně z nich odebrat nejde), v ní odcházejícího nechá i s přístupy, které skupina dává. Pravidla najdi a nahraď podmínkou na atribut účtu, nebo skupinu převeď na přiřazené členství.

## What changes — and what does not

| | After 3 Nov 2026 |
|---|---|
| Dynamic groups with `memberOf` in `membershipRule` | Membership frozen in its last state |
| Dynamic administrative units using `memberOf` | Frozen |
| Entitlement management auto-assignment policies using `memberOf` | Frozen |
| Graph `GET /users/{id}/memberOf`, `/transitiveMemberOf`, `/groups/{id}/members` | **Unchanged** — this is only the rule operator |

The operator never left preview. Even before the cutoff it had a documented limitation that matters for offboarding: removing a member from a *child* group does not remove them from the `memberOf` group until the rule is edited.

## Why it bites offboarding

A typical offboarding routine reads the user's direct groups and removes them from each one — except synced and dynamic groups, because Graph rejects removing a member from a group with `DynamicMembership` in `groupTypes`. That skip was safe while the rule engine cleaned up after you. With a frozen `memberOf` rule it is not: the user stays a member, and the routine reports success.

## Find affected groups

```http
GET https://graph.microsoft.com/v1.0/groups?$filter=groupTypes/any(t:t eq 'DynamicMembership')&$select=id,displayName,membershipRule&$top=999
```

Then filter client-side for rules containing `.memberof` (case-insensitive) — `membershipRule` does not support `$filter` with `contains`.

```js
const usesMemberOf = rule => !!rule && /\.memberof\b/i.test(rule);
```

During offboarding, read the rule of each skipped dynamic group (`GET /groups/{id}?$select=id,membershipRule`) and report `memberOf` groups as an **open item** ("user remains a member — fix the rule or convert the group"), not as an ordinary skip.

## Fix

- Replace `memberOf` with conditions on user attributes (`department`, `jobTitle`, `employeeType`, `extensionAttributeN`…).
- If no attribute expresses the set, convert the group to **assigned** membership and manage it explicitly.
- Validate membership after the change; pause or delete groups that are no longer needed.

## Sources

- Microsoft Learn — [Configure dynamic membership groups with the memberOf operator (preview)](https://learn.microsoft.com/entra/identity/users/groups-dynamic-rule-member-of), section *Migrate before the preview ends* and *Preview limitations*
- Message Center MC1448379 — *Microsoft Entra ID: Replace MemberOf rules by November 3, 2026*
