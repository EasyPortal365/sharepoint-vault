---
title: Renaming your SharePoint domain (contosoltd.sharepoint.com to contoso.sharepoint.com)
short-title: Renaming your SharePoint domain
summary: Scheduling a tenant rename on a fresh tenant – checking the name is free, adding the matching `.onmicrosoft.com` domain the right way, the 24-hour scheduling floor (error -772), what `-WhatIf` and the status output look like, and what to freeze until it finishes
tags: [powershell, governance, migration, guide]
applies-to: SharePoint Online
last-reviewed: 2026-11-10
---

# Renaming your SharePoint domain

> **Bottom line.** A tenant created with an awkward name (`contosoltd.sharepoint.com`) can be renamed to `contoso.sharepoint.com` with two steps: add `contoso.onmicrosoft.com` through **Add onmicrosoft domain** (not *Add domain*), then schedule `Start-SPOTenantRename` at least 24 hours ahead. It is irreversible and capped at two renames per tenant lifetime, so do it once, early – before there is content to break.
>
> **Ve zkratce.** Tenant založený s nešikovným názvem (`contosoltd.sharepoint.com`) jde přejmenovat na `contoso.sharepoint.com` ve dvou krocích: přidat `contoso.onmicrosoft.com` přes **Add onmicrosoft domain** (ne *Add domain*) a pak naplánovat `Start-SPOTenantRename` nejdřív za 24 hodin. Je to nevratné a za život tenantu to jde nejvýš dvakrát – udělejte to jednou a hned na začátku, dokud není co rozbít.

The SharePoint and OneDrive URLs come from the tenant's original `onmicrosoft.com` name chosen at sign-up – which may carry a legal-form suffix or a typo nobody noticed. Adding a custom domain doesn't change them, and neither does making a new `onmicrosoft.com` domain the fallback. The only way is the tenant rename.

Steps 0 to 3 come from a real rename scheduled in November 2026 on a freshly built tenant: two visible sites, no content yet, nobody using it. Step 4 follows Microsoft's docs – the run hadn't completed at the time of writing. That is the cheapest moment there will ever be – on a tenant in use, read Microsoft's [limitations table](https://learn.microsoft.com/sharepoint/change-your-sharepoint-domain-name#limitations-of-changing-a-sharepoint-domain-name) first; hub sites, Power Automate, Power BI, Teams tabs and anything with absolute URLs need follow-up work.

## Before you start

- **It's one-way.** You can't rename back to the original name, you get at most two renames in the tenant's lifetime, and a second one can't be scheduled within 30 days of the previous one completing. Get the name signed off by the tenant owner before step 2.
- **Deleted sites are lost for good.** Check *SharePoint admin center → Sites → Deleted sites* and restore anything worth keeping – sites deleted before the rename can't be restored after it.
- **Freeze licensing and admin roles.** Microsoft says purchases or changes to licences and storage, and creating or updating admin roles, don't take effect during the rename. If the customer is about to buy licences, either buy them before the scheduled start or after it finishes.
- **Old URLs keep working for a year** through a redirect, then stop.
- **E-mail addresses and sign-in names don't change** – only SharePoint and OneDrive URLs.

## Step 0: check the new name is free

Two quick probes, no sign-in needed:

```powershell
Resolve-DnsName contoso.sharepoint.com
Invoke-WebRequest "https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0/.well-known/openid-configuration" -SkipHttpErrorCheck | Select-Object StatusCode
```

- `contoso.sharepoint.com` doesn't resolve – the name is most likely free. (Microsoft's own check is the browser: a 404 means probably free, a sign-in page means taken.)
- The OpenID endpoint returns **400** for an `onmicrosoft.com` name no tenant owns and **200** for one that exists (try it on your current name to see the 200). You need both names, because step 1 claims the matching `onmicrosoft.com` domain.

(`-SkipHttpErrorCheck` is PowerShell 7. In Windows PowerShell 5.1 drop it – a 400 then throws a `WebException` and a 200 returns normally. `Resolve-DnsName` is Windows-only.)

The new name can't contain a hyphen or special characters, is limited to 48 characters, and can't be a name your tenant used before.

If another customer has the name, Microsoft can't tell you who or contact them for you. Pick another.

## Step 1: add the matching onmicrosoft.com domain

1. Microsoft 365 admin center → **Settings → Domains**.
2. Select your current **`contosoltd.onmicrosoft.com` (Default)** domain. Don't use the **Add domain** button at the top of the page – it adds a custom domain, not an `onmicrosoft.com` one.
3. In **About this domain**, select **Add onmicrosoft domain**, type `contoso`, select **Add domain**.
4. Wait until the new domain shows **Healthy**.
5. Do **not** select *Make fallback domain* on it.

This needs the Domain Name Administrator role (Global Administrator includes it). Check the spelling twice: a tenant can have at most five `onmicrosoft.com` domains and they can't be deleted.

## Step 2: schedule the rename

On Windows (the module doesn't run on a Mac), in Windows PowerShell 5.1, signed in as at least a SharePoint Administrator:

```powershell
Uninstall-Module Microsoft.Online.SharePoint.PowerShell -AllVersions -Force -ErrorAction SilentlyContinue
Install-Module -Name Microsoft.Online.SharePoint.PowerShell -Scope CurrentUser -Force
Connect-SPOService -Url "https://contosoltd-admin.sharepoint.com"
```

If the sign-in fails with `Unable to load DLL 'msalruntime'` followed by `No valid OAuth 2.0 authentication session exists`, the Windows sign-in broker couldn't start. Sign in through the browser instead – pick the admin account of the tenant being renamed, not whatever account the browser offers first:

```powershell
Connect-SPOService -Url "https://contosoltd-admin.sharepoint.com" -UseSystemBrowser $true
```

Dry run first:

```powershell
Start-SPOTenantRename -DomainName "contoso" -ScheduledDateTime "2026-11-14T08:00:00" -WhatIf
```

The output looks alarming but is the normal `-WhatIf` result – nothing was scheduled:

```text
What if: Performing the operation "Start-SPOTenantRename."
You have aborted the rename operation.
```

The scheduled time is the **local time of the machine you run it on**, and it must be at least 24 hours and at most 30 days ahead. Typing a time a few hours away fails *after* you confirm, with error code -772 (the message is localized; on a Czech system it read `Error Code: -772,Plánované datum a čas musí být v budoucnosti 24 hodin.` – the scheduled date and time must be 24 hours in the future). Computing the time avoids both the error and any doubt about which clock counts:

```powershell
$when = (Get-Date).AddHours(25).ToString("s"); $when
Start-SPOTenantRename -DomainName "contoso" -ScheduledDateTime $when
```

Answer `Y` to the confirmation. Success prints a `RenameJobID`. Until the start time you can still cancel – the `-Reason` is mandatory:

```powershell
Stop-SPOTenantRename -Reason "Rescheduling"
```

## Step 3: check what got scheduled

```powershell
Get-SPOTenantRenameStatus
```

```text
RenameJobId     : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (redacted)
Status          : Queued
Requested at    : 11/10/2026 5:30:54 PM (UTC)
Requested by    : admin@contosoltd.onmicrosoft.com
Scheduled at    : 11/11/2026 6:30:47 PM (UTC)
New domain name : contoso
Total sites     : 5

In progress       : 0
Renamed           : 0
Attention required: 0
```

- Times are shown in **UTC** – our 19:30 Central European time appears as 6:30 PM. Check the offset matches what you meant.
- **Total sites** counted 5 although *Active sites* in the admin center listed only two. The rename counts sites that list doesn't show, so don't read a mismatch as an error (we didn't break the five down).
- **Attention required** is the number to watch. If more than 10 % of sites fail to rename, the whole operation suspends and needs a support request to resume.

Once it starts, sites still waiting for their turn are briefly inaccessible, and creating new sites, teams or private channels is blocked until it finishes. Microsoft puts the duration at hours to days depending on the number of sites. Schedule it for a quiet evening or weekend and tell users.

When you're done, `Disconnect-SPOService`. Don't plan UPN changes until the rename completes. Once it has started, check progress from a new PowerShell window; if `Get-SPOTenantRenameStatus` returns access denied, connect to the new admin URL (`https://contoso-admin.sharepoint.com`).

A status of all zeros right after scheduling (a zero `RenameJobId`) is Microsoft's documented symptom of an outdated module – that's why the install step removes old versions first.

## Step 4: after it completes

- `Get-SPOTenantRenameStatus` shows every site under **Renamed** and **Attention required: 0**. For the per-site list, `Get-SPOSiteRenameState -ParentOperationID <RenameJobID>`.
- Open `https://contoso.sharepoint.com` and the admin center at `https://contoso-admin.sharepoint.com`, and try one of the old URLs to see the redirect.
- On a tenant that was already in use, walk the [limitations table](https://learn.microsoft.com/sharepoint/change-your-sharepoint-domain-name#limitations-of-changing-a-sharepoint-domain-name) – re-register hub sites, fix absolute URLs in navigation, flows and apps, and republish isolated SPFx solutions.

## Notes

- The fallback domain stays `contosoltd.onmicrosoft.com`. That's fine: sign-in names come from the users' UPNs, which normally use your custom domain, not the fallback.
- The standard rename covers tenants with up to 10,000 sites; multi-geo, government clouds and vanity domains can't be renamed at all.
- Microsoft's docs: [Errors when renaming](https://learn.microsoft.com/sharepoint/troubleshoot/administration/errors-when-renaming), [Change your SharePoint domain name](https://learn.microsoft.com/sharepoint/change-your-sharepoint-domain-name), [Add an onmicrosoft.com domain](https://learn.microsoft.com/microsoft-365/admin/setup/add-or-replace-your-onmicrosoftcom-domain), [Connect-SPOService](https://learn.microsoft.com/powershell/module/microsoft.online.sharepoint.powershell/connect-sposervice).
