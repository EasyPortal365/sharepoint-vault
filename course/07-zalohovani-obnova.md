---
title: "Kapitola 07 – Zálohování a obnova dat"
chapter: 7
course: MSHP-ONLINE
lang: cs
last-reviewed: 2026-07-18
---

# Kapitola 07 – Zálohování a obnova dat

> **Bottom line.** SharePoint's built-in safety net — versioning and the two-stage recycle bins (93 days) — is recovery, not backup; know where it ends and where Microsoft 365 Backup or a third-party tool begins.
>
> **Ve zkratce.** Vestavěná záchranná síť SharePointu – verzování a dvoustupňové koše (93 dnů) – je obnova, ne záloha; věz, kde končí a kde začíná Microsoft 365 Backup nebo řešení třetí strany.

Verzování, odpadkové koše, Microsoft 365 Backup a zálohovací řešení třetích stran.

## Nastavení verzování

Verzování je první linie obrany proti nechtěné změně nebo smazání obsahu – umožňuje vrátit se k předchozí verzi souboru nebo položky.

Reference: [Jak funguje správa verzí v seznamech a knihovnách](https://support.microsoft.com/cs-cz/office/jak-funguje-spr%C3%A1va-verz%C3%AD-v-seznamech-a-knihovn%C3%A1ch-0f6cd105-974f-44a4-aadb-43ac5bdfd247)

## Odpadkové koše

SharePoint má **dvě úrovně koše**:

- **Odpadkový koš koncového uživatele** – *Site Contents → Recycle Bin*
- **Odpadkový koš správce kolekce webů** – *Site Settings → Recycle Bin* (druhá úroveň, kam se dostane obsah smazaný z prvního koše)

**Jak dlouho se uchovávají smazaná data?** **93 dnů** ([Restore deleted items from the site collection recycle bin](https://learn.microsoft.com/en-us/sharepoint/restore-deleted-items-from-site-collection-recycle-bin)).

> Skript pro zjištění velikosti alokovaného místa najdete v [kapitole 09 – SharePoint Online a PowerShell](09-powershell.md).

## Zálohy obsahu SharePoint Online webů či tenantů

Koše a verzování **nejsou plnohodnotná záloha** – po 93 dnech jsou data nenávratně pryč. Pro delší ochranu je potřeba skutečné zálohovací řešení.

### Microsoft 365 Backup

Nativní služba Microsoftu ([Overview of Microsoft 365 Backup](https://learn.microsoft.com/en-us/microsoft-365/backup/backup-overview)). Nastavuje se v *Nastavení → Zálohování Microsoft 365*.

- Umožňuje určit **frekvenci** záloh a **dobu uchování**, případně vybrat jen konkrétní weby.
- Je to **jen site-level backup**.
- Pokrývá **SharePoint, Exchange a OneDrive**.
- Zabezpečené (data neopouštějí Microsoft cloud).
- **Rychlé obnovení** – v řádu minut, a to i u dat starých až týden.
- **Ceny:** cca **0,15 USD / GB / měsíc** ([Pricing model](https://learn.microsoft.com/en-us/microsoft-365/backup/backup-pricing)).

### Zálohovací řešení třetích stran

Alternativy s vlastní kopií dat mimo Microsoft cloud:

- **[Veeam](https://www.veeam.com/products/saas/backup-microsoft-office-365.html)** – Backup for Microsoft 365.
- **[CloudAlly](https://www.cloudally.com/)**
- **[AFI.AI](https://afi.ai/office-365-backup)**
- **[Synology Active Backup for Microsoft 365](https://www.synology.com/en-global/dsm/feature/active_backup_office365)** – OneDrive, Exchange, SharePoint, Teams. Bezplatný add-on k zařízením Synology NAS.

---

*Součást kurzu [„Microsoft SharePoint Online – administrace od A do Z"](README.md). Vede [Kamil Juřík](https://www.linkedin.com/in/kamiljurik/) · [okskoleni.cz/kurzy/detail/MSHP-ONLINE](https://www.okskoleni.cz/kurzy/detail/MSHP-ONLINE)*
