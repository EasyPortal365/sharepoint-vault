---
title: Integrated apps says "Invalid manifest file" for a valid Office add-in manifest – the file arrived as application/xml, not text/xml
summary: "When you update or upload an Office add-in manifest in the Microsoft 365 admin center (Settings → Integrated apps) through browser automation, every file can be rejected instantly with \"Invalid manifest file\" and no network request. The form's client-side check rejected the file typed application/xml (as a Chrome-extension upload set it) and accepted the same bytes typed text/xml. Re-wrap the File as text/xml via DataTransfer and fire input + change"
tags: [office-add-ins, manifest, m365-admin-center, integrated-apps, browser-automation, tooling]
applies-to: Microsoft 365 admin center → Settings → Integrated apps (Upload custom apps, Update add-in) with an add-in-only XML manifest, driven by a browser automation tool (Chrome extension, Playwright setInputFiles, DataTransfer)
last-reviewed: 2026-11-24
---

# Integrated apps says "Invalid manifest file" for a valid Office add-in manifest – the file arrived as application/xml, not text/xml

> **Bottom line.** You update a deployed add-in in **Integrated apps → Update add-in → Upload manifest file (.xml) from device**, and every manifest is rejected straight away with **"Invalid manifest file"**. This happens even with a manifest that differs from an accepted one only in `<Version>`, and the browser sends no network request. The check runs in the page and looks at `File.type`. In our case, the Claude in Chrome extension put the file into the `<input type="file">` as **`application/xml`** and the form rejected it. The same bytes re-wrapped as **`text/xml`** passed ("Manifest file validated"). Other automation tools may set other types, so check `files[0].type`.
>
> **Ve zkratce.** Doplněk v **Integrated apps → Update add-in** aktualizuješ nahráním manifestu a každý soubor je hned odmítnut hláškou **„Invalid manifest file“**. Stane se to i u manifestu, který se od přijatého liší jen verzí, a prohlížeč přitom neodešle žádný požadavek. Kontrola běží ve stránce a dívá se na `File.type`. Rozšíření Claude in Chrome vložilo soubor jako **`application/xml`** a formulář ho odmítl. Tentýž obsah přebalený na **`text/xml`** prošel.

## Symptom

- "Invalid manifest file" appears under the file box immediately after the file is set.
- No request appears in the network log, so the rejection is client-side.
- A manifest that differs only in version, or one with a deliberately lower version, fails the same way, so the content is not the cause.
- Reading the input shows the type: `document.querySelector('input[type=file]').files[0].type` → `"application/xml"`.

## Fix

After the automation tool has set the file, replace it with a `text/xml` copy and notify the form:

```js
const input = document.querySelector('input[type=file]');
const f = input.files[0];
const xml = new File([await f.arrayBuffer()], f.name, { type: 'text/xml', lastModified: Date.now() });
const dt = new DataTransfer();
dt.items.add(xml);
input.files = dt.files;
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
```

The form then shows "Uploading and validating" and, for a correct manifest, "Manifest file validated" followed by **Next → Accept and update**. Playwright's `setInputFiles` takes a file payload with an explicit type (`{ name, mimeType: 'text/xml', buffer }`). We have not tested that route against this form.

## Second trap in the same screen

The details flyout does not always switch when you click a different row in the list. You can open **Update add-in** for the wrong app. You only notice when a correctly typed file returns *"Upload failed because the manifest file has a different product ID"*. Before you update, check the flyout header (Host Product, Assigned users). If it shows the wrong app, close the flyout and open the row again.

## Good to know

- Updating the manifest keeps the existing user assignment ("Specific set of users" or "Entire organization").
- The new `<Version>` must be higher than the deployed one. Otherwise Office clients keep the old manifest.
