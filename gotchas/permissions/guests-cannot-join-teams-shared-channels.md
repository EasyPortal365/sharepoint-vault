---
title: "Guests cannot join a Teams shared channel — only people from another Microsoft 365 organisation can"
short-title: "Guests cannot join Teams shared channels"
summary: Shared channels admit external people only through B2B direct connect between two Entra tenants; a guest account cannot be added, so a partner without their own Microsoft 365 needs a different design
tags: [permissions, teams, shared-channels, guests, b2b, external-sharing]
applies-to: Microsoft Teams and SharePoint Online; Microsoft Entra External ID (B2B collaboration and B2B direct connect)
last-reviewed: 2026-10-07
---

# Guests cannot join a Teams shared channel — only people from another Microsoft 365 organisation can

> **Bottom line.** A shared channel is the natural answer to "the architect should see one channel, not the whole team" — but it only works for people whose company has its **own Microsoft Entra tenant**, and only after **both** organisations allow each other in cross-tenant access settings (B2B direct connect). A guest account (B2B collaboration) cannot be added to a shared channel at all. Before you promise "external partners get their own shared channel", ask whether each partner has Microsoft 365; for those who don't, plan guest access to the library or a separate site instead.
>
> **Ve zkratce.** Sdílený kanál je přirozená odpověď na „architekt má vidět jeden kanál, ne celý tým“ – funguje ale jen pro lidi, jejichž firma má **vlastní tenant Microsoft Entra**, a jen když si **obě** organizace povolí propojení v nastavení přístupu mezi tenanty (B2B direct connect). Účet hosta (B2B collaboration) do sdíleného kanálu přidat nejde vůbec. Než slíbíte „každý partner dostane sdílený kanál“, zjistěte, kdo z partnerů má Microsoft 365; pro ostatní naplánujte přístup hosta do knihovny nebo na samostatný web.

## Symptom

A collaboration design — a proposal, a prototype, a team template — puts external partners (an architect, a contractor, a supervisor) into a **shared channel** of the project team so they see their channel and nothing else. When it is built:

- the owner tries to add the partner's e-mail to the shared channel and the partner is not found, or the add fails with an admin-policy message;
- a partner who was invited to the team as a guest sees the team's standard channels, but the shared channel never appears for them;
- partners from a company with Microsoft 365 work fine, partners using a personal or non-Microsoft address do not.

## Cause

Teams has two different external-access mechanisms and they do not mix:

| | Guest access (B2B collaboration) | Shared channel (B2B direct connect) |
|---|---|---|
| Who | anyone with an e-mail address | users of **another Microsoft Entra organisation** |
| Account in your tenant | yes, a guest user | no |
| Setup | guest access enabled | cross-tenant access settings configured **by both organisations**, plus guest access in Teams enabled |
| Scope | the whole team (standard channels, files) | only the shared channel |

Microsoft states it directly: guests "can't be added to a shared channel"; external people participate through B2B direct connect, which requires a mutual trust relationship between the two tenants. A guest invited to the team also cannot see or participate in the team's shared channels.

## Fix

Design for both kinds of partner up front:

1. **Partner with their own Microsoft 365:** shared channel via B2B direct connect. Agree the cross-tenant access settings with the partner's IT once (inbound on your side, outbound on theirs; trust their MFA if your conditional access requires it).
2. **Partner without Microsoft 365:** invite as a guest, but **not** to the whole team if they should see only part of it. Give access to the specific library folders or a separate partner site, with an expiry date on the guest's access.
3. In proposals and templates, say which of the two you mean — "shared channel" quietly assumes the partner has Microsoft 365.

## Sources

- [Shared channels in Microsoft Teams](https://learn.microsoft.com/microsoftteams/shared-channels) — "guests … can't be added to a shared channel"; cross-tenant access settings required by each organisation.
- [B2B direct connect overview](https://learn.microsoft.com/entra/external-id/b2b-direct-connect-overview) — mutual trust between two Entra organisations; guest users can't see or participate in shared channels.
