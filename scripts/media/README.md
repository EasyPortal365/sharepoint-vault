# 🎬 Terminal animations

Animated SVGs showing what the writing scripts print in a PowerShell window, so you can see the shape of a run before you commit to one.

Each one plays a whole interaction: the command is typed out word by word with the caret moving along behind it, then Enter, then the output appears line by line. It runs **once** and stops on the finished transcript — no loop, nothing blinking away in the corner of your eye while you read.

Plain SVG with the CSS inside it — no JavaScript, no external assets — so it animates when embedded as an ordinary image. Anyone with `prefers-reduced-motion` set gets the finished transcript immediately, and so does any surface that strips CSS from SVG (GitHub's markdown renderer does, and so do print and thumbnails): the fallback is the whole output, never an empty window.

| Animation | Script |
|---|---|
| [set-sharing-capability.svg](/scripts/media/set-sharing-capability.svg ':ignore :target=_blank') | [Set-SiteSharingCapability.ps1](../permissions/Set-SiteSharingCapability.ps1) — a `-WhatIf` dry run |
| [set-default-link-permission.svg](/scripts/media/set-default-link-permission.svg ':ignore :target=_blank') | [Set-SiteDefaultLinkPermission.ps1](../permissions/Set-SiteDefaultLinkPermission.ps1) — a real tenant-wide run |
| [set-access-request-settings.svg](/scripts/media/set-access-request-settings.svg ':ignore :target=_blank') | [Set-SiteAccessRequestSettings.ps1](../permissions/Set-SiteAccessRequestSettings.ps1) — one site, two settings changed |

They are also embedded in [sample-outputs.md](../sample-outputs.md) next to the written transcript of each script — that is the page to read if you want the animation and the copy-pasteable text side by side.

The transcripts are the sanitised output from [sample-outputs.md](../sample-outputs.md), so the animation and the written sample never drift apart.

## Regenerating

`build-terminal-svg.mjs` holds the transcripts and emits all three files. It is Node, not PowerShell — it maintains the illustrations, it is not a SharePoint tool.

```bash
node build-terminal-svg.mjs .
```

Colours follow the `Write-Host` foregrounds the scripts actually use (red for the warning banner, cyan for progress, green for a change, yellow for a skip, grey for a no-op). The character width in the file is measured, not guessed — if you change the font size, re-measure it with `canvas.measureText`, or the caret drifts away from the end of the words it is supposed to follow.

One note if you ever debug these: a browser tab that is not actually on screen has a frozen animation timeline, so a screenshot of one shows frame zero no matter how long you wait. To check the timing, drive it yourself rather than watching it — open the SVG, then step the clock through `document.getAnimations().forEach(a => a.currentTime = 1700)` and read the state at that instant.
