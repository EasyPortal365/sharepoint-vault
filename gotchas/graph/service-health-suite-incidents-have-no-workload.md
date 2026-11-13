---
title: Service health — a cross-service outage is filed under "Microsoft 365 suite", not under SharePoint or Exchange
short-title: Suite incidents (MO…) slip past a per-service filter
summary: "Filtering `serviceAnnouncement/issues` by `service` dropped MO1550821 (12 Nov 2026), which took down SharePoint, Exchange and Teams — its service was `Microsoft 365 suite`"
tags: [graph, service-health, service-communications, monitoring, status-page]
applies-to: Microsoft Graph v1.0 /admin/serviceAnnouncement/issues (application ServiceHealth.Read.All)
last-reviewed: 2026-11-13
---

# Suite incidents slip past a per-service filter

> **Bottom line.** Microsoft files a cross-service outage under `service: "Microsoft 365 suite"` (incident ID prefix `MO`), not under each workload. A status page that kept only issues whose `service` matched "SharePoint Online", "Exchange Online" and so on showed SharePoint green while incident **MO1550821** ("Users may be unable to connect to multiple Microsoft 365 services", from 12 Nov 2026 18:26 UTC) was open. Map suite incidents onto the workloads named in their text instead of dropping them.
>
> **Ve zkratce.** Výpadek přes víc služeb vede Microsoft pod `service: "Microsoft 365 suite"` (ID začíná `MO`), ne pod jednotlivé služby. Stránka stavu, která brala jen incidenty se `service` „SharePoint Online“, „Exchange Online“ atd., ukazovala SharePoint zeleně, zatímco incident **MO1550821** („Users may be unable to connect to multiple Microsoft 365 services“, od 12. 11. 2026 18:26 UTC) byl otevřený. Společný incident rozlož na služby jmenované v textu, nezahazuj ho.

## Symptom

Users report SharePoint (or Outlook, Teams) down; your dashboard built on `/admin/serviceAnnouncement/issues` shows the service as healthy with no incident.

## Fix

```ts
const TRACKED = [
  { key: 'sharepoint', service: /sharepoint/i, text: /sharepoint/i },
  { key: 'exchange',   service: /exchange/i,   text: /exchange|outlook|mailbox/i },
  { key: 'teams',      service: /teams/i,      text: /\bteams\b/i },
  { key: 'onedrive',   service: /onedrive/i,   text: /onedrive/i },
  { key: 'entra',      service: /entra|azure active directory/i, text: /\bentra\b|sign[- ]?in|authenticat/i },
];

function affected(issue): string[] {
  const direct = TRACKED.find(t => t.service.test(issue.service || ''));
  if (direct) return [direct.key];
  if (!/microsoft 365 suite/i.test(issue.service || '')) return [];
  const text = [issue.title, issue.impactDescription, issue.feature, issue.featureGroup].join(' ');
  const named = TRACKED.filter(t => t.text.test(text)).map(t => t.key);
  return named.length ? named : ['sharepoint', 'exchange', 'teams', 'onedrive']; // "multiple services", none named
}
```

- Store one record per affected workload (e.g. `MO1550821~sharepoint`) so per-service history works, and **merge them back into one item** in the UI — otherwise one incident shows up four times.
- Keep filtering on `classification eq 'incident'` if you only want incidents; the suite incident above was an incident with status `serviceDegradation`.

## Notes

- Verified 2026-11-13 on one tenant with an app-only token (`ServiceHealth.Read.All`): after the change, MO1550821 appeared on the next 15-minute poll. The `service` value was inferred from the `MO` prefix and confirmed by the code path (the issue matched no workload regex and was picked up only by the suite branch).
- Most incidents are partial ("some users", one feature) and often run for days. Don't turn them into an uptime percentage: weighting them as partial downtime put Exchange at 88 % over 90 days, which read as "down for days". Show days with reports, and reserve "outage" for `serviceInterruption`.
- `healthOverviews.status` can say `serviceDegradation` because of advisories. If your page ignores advisories, derive the per-service badge from open incidents only, or the badge contradicts the incident list.
