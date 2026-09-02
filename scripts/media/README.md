# 🎬 Terminal animations

Animated SVGs showing what the writing scripts print in a PowerShell window, so you can see the shape of a run before you commit to one.

Each is a plain SVG with the CSS animation inside it — no JavaScript, no external assets, so it animates when embedded as an ordinary image. Lines fade in one after another, the cursor blinks, and the loop restarts after a pause. Anyone who has `prefers-reduced-motion` set sees the finished frame with no animation at all.

| Animation | Script |
|---|---|
| [set-sharing-capability.svg](set-sharing-capability.svg) | [Set-SiteSharingCapability.ps1](../permissions/Set-SiteSharingCapability.ps1) — a `-WhatIf` dry run |
| [set-default-link-permission.svg](set-default-link-permission.svg) | [Set-SiteDefaultLinkPermission.ps1](../permissions/Set-SiteDefaultLinkPermission.ps1) — a real tenant-wide run |
| [set-access-request-settings.svg](set-access-request-settings.svg) | [Set-SiteAccessRequestSettings.ps1](../permissions/Set-SiteAccessRequestSettings.ps1) — one site, two settings changed |

The transcripts are the sanitised output from [sample-outputs.md](../sample-outputs.md), so the animation and the written sample never drift apart.

## Regenerating

`build-terminal-svg.mjs` holds the transcripts and emits all three files. It is Node, not PowerShell — it maintains the illustrations, it is not a SharePoint tool.

```bash
node build-terminal-svg.mjs .
```

Colours follow the `Write-Host` foregrounds the scripts actually use (red for the warning banner, cyan for progress, green for a change, yellow for a skip, grey for a no-op). The character width in the file is measured, not guessed — if you change the font size, re-measure it with `canvas.measureText`, or the cursor drifts away from the end of the prompt.
