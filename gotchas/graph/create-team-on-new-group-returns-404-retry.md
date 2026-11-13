---
title: Creating a team right after creating its Microsoft 365 group returns 404 — retry only the 404, and don't log the failure as success
short-title: PUT /groups/{id}/team on a new group returns 404
summary: "`PUT /groups/{id}/team` fails with 404 for minutes after `POST /groups` (replication); retry only 404, surface a real failure as a warning"
tags: [graph, teams, groups, provisioning, retry, spfx]
applies-to: Microsoft Graph v1.0 (delegated Group.ReadWrite.All / Team.Create), Microsoft 365 groups, Microsoft Teams
last-reviewed: 2026-11-13
---

# Creating a team on a brand-new Microsoft 365 group returns 404

> **Bottom line.** If you call `PUT /groups/{id}/team` right after `POST /groups`, Graph often answers **404**: the new group is not replicated yet. The same call succeeds a few minutes later under the same account. Retry **only on 404** (Microsoft suggests up to three retries 10 seconds apart; if it still fails, wait until 15 minutes have passed since the group was created); return 403/400 at once. And if the team still isn't created, say so as a warning — a provisioning log that shows "could not create the team" with a green tick is a state that lies.
>
> **Ve zkratce.** `PUT /groups/{id}/team` hned po `POST /groups` vrací **404** – Graph novou skupinu ještě replikuje; týž požadavek o pár minut později projde. Opakujte **jen 404** (Microsoft radí až tři pokusy po 10 s; když ani pak, počkat, až od založení skupiny uplyne 15 minut), 403/400 vraťte hned. A když tým nevznikne, ukažte to jako upozornění – „tým se nepodařilo založit“ se zelenou fajfkou je stav, který lže.

## Symptom

A site-provisioning web part creates a Microsoft 365 group and then a team on top of it:

```http
POST https://graph.microsoft.com/v1.0/groups
{ "displayName": "Project Apollo", "mailNickname": "project-apollo", "groupTypes": ["Unified"],
  "mailEnabled": true, "securityEnabled": false, "visibility": "Public" }

PUT https://graph.microsoft.com/v1.0/groups/{id}/team
{ "memberSettings": { "allowCreateUpdateChannels": true } }
```

The group and its SharePoint site are created, but the team isn't. The `PUT` was wrapped in `try/catch` with no retry, and the log line "The team could not be created — it can be added later" was rendered with the same green tick as the successful steps.

## Cause

Measured on a test tenant (delegated, Global Administrator):

| When | `PUT /groups/{id}/team` |
|---|---|
| right after the group and site were ready | 404 |
| about 5 minutes later, same account, same body | succeeded, team created |

So it is not a permission problem — it is replication. Microsoft Learn says the same on the [Create team](https://learn.microsoft.com/en-us/graph/api/team-put-teams?view=graph-rest-1.0) page: a group created less than 15 minutes ago may make the call fail, and it suggests retrying.

## Fix

```ts
function statusOf(e: unknown): number {
  const s = (e && typeof e === 'object' ? e : {}) as { statusCode?: unknown; status?: unknown };
  return typeof s.statusCode === 'number' ? s.statusCode : typeof s.status === 'number' ? s.status : 0;
}

/** Retries ONLY 404 (replication). Any other error is returned at once. */
async function createTeamWithRetry(create: () => Promise<void>, attempts = 8, delayMs = 15000): Promise<number> {
  for (let i = 1; ; i++) {
    try { await create(); return i; }
    catch (e) {
      if (i >= attempts || statusOf(e) !== 404) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// usage with the SPFx Graph client
await createTeamWithRetry(() => graph.api(`/groups/${groupId}/team`).put(teamSettings));
```

- Retrying 403 would only delay the real message ("the app has no permission to create teams").
- Keep the total wait bounded and tell the user the step may take a couple of minutes.
- If it still fails, log it as a **warning**, and say who does what next (for example, "the owner can create the team in Teams from the site's Microsoft 365 group") — don't promise an "add later" button you don't have.

## Takeaways

- A `404` from `/groups/{id}/...` right after `POST /groups` usually means "not replicated yet", not "doesn't exist".
- Test the hypothesis by repeating the exact call a few minutes later under the same account before you touch permissions.
- Best-effort steps need three states in the log: done, warning, failed. A swallowed exception must not look like success.
