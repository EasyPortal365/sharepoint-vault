---
title: SPFx extensions do not load on Doc.aspx, and the open Office document is out of reach of page code
short-title: SPFx extensions do not load on Doc.aspx
summary: "A tenant-wide Application Customizer was not loaded on `_layouts/15/Doc.aspx` and the Office editor ran in a cross-origin frame, so working with the open document needs an Office Add-in"
tags: [spfx, application-customizer, office-for-the-web, office-add-in, iframe]
applies-to: SharePoint Online, SharePoint Framework extensions, Office for the web
last-reviewed: 2026-11-19
---

# Your SPFx extension stops at the door of an open Office document

> **Bottom line.** When a user opens an Office file in the browser, the address is still on SharePoint (`/_layouts/15/Doc.aspx`), but in our test SharePoint did not load a tenant-wide Application Customizer there and the editor itself ran in a frame from another domain. A floating widget, banner or assistant built as an Application Customizer does not appear, and code on the SharePoint page cannot read or change the document. The supported way to work with the open document is an Office Add-in.
>
> **Ve zkratce.** Dokument Office otevřený v prohlížeči má adresu na SharePointu (`/_layouts/15/Doc.aspx`), ale v našem testu tam SharePoint nenačetl tenantové rozšíření Application Customizer a samotný editor běžel v rámci z jiné domény. Widget postavený jako Application Customizer se neobjeví a kód stránky SharePointu dokument nepřečte ani neupraví. Podporovaná cesta k otevřenému dokumentu je doplněk Office.

## Symptom

An Application Customizer is deployed tenant-wide and shows on modern pages and in libraries. Users report that it "disappears" as soon as they open a document, and they expect it to follow them there.

## Cause

Two separate things, and both have to be understood before choosing a fix.

1. **`Doc.aspx` is a thin host page, not a modern page.** SharePoint Framework extensions are documented for modern pages and document libraries. On `Doc.aspx`, in our test with a PowerPoint presentation, the extension was not requested — the browser's network log showed no call for its bundle at all. Nothing was broken; the page did not act as an extension host.
2. **The editor is a cross-origin frame.** In the same test, PowerPoint for the web was served from `*.officeapps.live.com` and embedded in the SharePoint page; expect the same for Word and Excel and confirm it with the steps below. The browser's same-origin policy keeps any script on the SharePoint page out of that frame. Even if your code did run on `Doc.aspx`, it would only know which file is open (from the URL), not what is in it — and what is on screen may be newer than the last saved version, because Office for the web saves the document periodically, not on every keystroke.

## How to confirm

1. Open a document in the browser and check the address: `…/_layouts/15/Doc.aspx?sourcedoc=…`.
2. In developer tools, filter the network log by your bundle's host. On a modern page the bundle loads; on `Doc.aspx` it does not.
3. In the Elements panel, find the `iframe` that holds the editor and look at its origin.

## What to do instead

| Goal | Approach |
|---|---|
| Read or change the document the user is working on | Office Add-in (task pane, Office.js). Runs inside Word, Excel and PowerPoint on the web and on desktop, deployed by an admin from the Microsoft 365 admin center |
| Change an Excel workbook from outside | Microsoft Graph workbook API (`/workbook`): `Files.ReadWrite` for the user's own files, `Files.ReadWrite.All` for workbooks in SharePoint libraries |
| Work with a file that is not open | SharePoint REST or Graph from wherever your extension does run (the library view, a page), reading and writing the saved file |

Do not try to detect the document from the SharePoint page and patch the saved file while it is open. Office for the web takes a lock on the file while editing and writes its own copy back periodically (the behaviour is documented for hosts that integrate Office for the web), so a write from outside competes with the editing session.

## References

- [Overview of SharePoint Framework Extensions](https://learn.microsoft.com/sharepoint/dev/spfx/extensions/overview-extensions)
- [Office Add-ins platform overview](https://learn.microsoft.com/office/dev/add-ins/overview/office-add-ins)
- [Deploy Office Add-ins in the Microsoft 365 admin center](https://learn.microsoft.com/microsoft-365/admin/manage/manage-deployment-of-add-ins)
- [Co-authoring using Microsoft 365 for the web](https://learn.microsoft.com/microsoft-365/cloud-storage-partner-program/online/scenarios/coauth)
