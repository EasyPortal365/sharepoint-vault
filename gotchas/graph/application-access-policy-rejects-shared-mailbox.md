---
title: ApplicationAccessPolicy won't scope to a shared mailbox — use a mail-enabled security group
tags: [graph, exchange-online, mail-send, permissions, powershell, shared-mailbox]
applies-to: Exchange Online, Microsoft Graph (application permissions), ExchangeOnlineManagement PowerShell
last-reviewed: 2026-08-07
---

# `ApplicationAccessPolicy` won't scope to a shared mailbox

> **Bottom line.** After granting an app the application-level `Mail.Send` permission it can send as *anyone* in the tenant, so you fence it in with `New-ApplicationAccessPolicy`. Passing the shared mailbox as `-PolicyScopeGroupId` fails with `The identity of the policy scope is not a security principal.` — a shared mailbox has a disabled account and isn't one. Put the mailbox in a **mail-enabled security group** and scope the policy to that group instead.
>
> **Ve zkratce.** Když aplikaci udělíte aplikační oprávnění `Mail.Send`, může odesílat za **kohokoli** v tenantu – proto se rozsah omezuje přes `New-ApplicationAccessPolicy`. Předání sdílené schránky jako `-PolicyScopeGroupId` skončí chybou `The identity of the policy scope is not a security principal.`, protože sdílená schránka má zakázaný účet a principal to není. Vložte schránku do **mail-enabled security group** a policy nasměrujte na tu skupinu.

## Symptom

You created a shared mailbox for an unattended sender (`support@`, `noreply@`) and want the app restricted to it:

```powershell
New-ApplicationAccessPolicy -AppId <appId> `
  -PolicyScopeGroupId support@contoso.com `
  -AccessRight RestrictAccess -Description "Mailer - support mailbox only"
```

```
New-ApplicationAccessPolicy: ||The identity of the policy scope is not a security principal.
```

Using the mailbox GUID (`ExternalDirectoryObjectId`) instead of the SMTP address fails the same way.

## Cause

`-PolicyScopeGroupId` accepts a **security principal**: a mail-enabled security group, a Microsoft 365 group, or a regular user mailbox. A shared mailbox is backed by a *disabled* user account, so Exchange refuses it as a policy scope.

Waiting doesn't help either. A freshly created mailbox also emits `An error occurred while trying to prepopulate newly created mailbox … Error: 0x8004010F` warnings, which look like a replication delay and tempt you into retrying for a while — but the rejection is by design, not a timing issue.

## Fix

Wrap the mailbox in a mail-enabled security group and scope the policy to the group:

```powershell
$smtp  = "support@contoso.com"
$appId = "<application (client) id>"
$group = "Mailer Scope"

# 1) mail-enabled security group holding every mailbox the app may send as
New-DistributionGroup -Name $group -Type Security `
  -PrimarySmtpAddress "mailer-scope@contoso.com"
Add-DistributionGroupMember -Identity $group -Member $smtp

# 2) scope the app to that group
New-ApplicationAccessPolicy -AppId $appId `
  -PolicyScopeGroupId "mailer-scope@contoso.com" `
  -AccessRight RestrictAccess -Description "Mailer - scoped senders only"

# 3) verify BOTH directions - a policy you never tested is a policy you don't have
Test-ApplicationAccessPolicy -Identity $smtp -AppId $appId              # Granted
Test-ApplicationAccessPolicy -Identity ceo@contoso.com -AppId $appId    # Denied
```

Adding another allowed sender later is then group membership, not a second policy.

Propagation takes up to about an hour. Right after the change, a `403` from `sendMail` is expected — wait before you debug it.

## Related traps in the same job

**A shared mailbox needs no licence.** `New-Mailbox -Shared` gives you up to 50 GB for free and app-only `Mail.Send` works against it normally — the right home for an unattended `support@` sender.

**Exchange sessions don't survive between separate shell invocations.** `Connect-ExchangeOnline` lives in process memory only. If your automation runs each command in a fresh process, connect **and** run the commands in one invocation; `Connect-AzAccount` behaves differently because it persists its context to disk.

**You may not need a second interactive sign-in for Graph.** If you're already signed in with Azure PowerShell as an administrator, `Get-AzAccessToken -ResourceUrl "https://graph.microsoft.com"` often returns a token whose `scp` already covers `Application.ReadWrite.All` and `AppRoleAssignment.ReadWrite.All` — enough to create the app registration and grant admin consent over REST. Decode the payload and check `scp` before relying on it. The token comes back as a `SecureString`; unwrap it with `[System.Net.NetworkCredential]::new("", $token).Password`.

**Function App settings are written as a whole set.** `PUT …/config/appsettings` replaces everything. Read the current settings, merge your keys in, then write — and afterwards verify the pre-existing keys are still present. Writing only the new keys wipes the rest.
