// Generator animovanych SVG "terminalu" pro vault.
// Radky se objevuji postupne (fade-in), kurzor blika, cyklus se opakuje.
// CSS je uvnitr SVG, takze to funguje i kdyz je SVG vlozene jako <img>.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const COL = {
  def:  '#CCCCCC',
  cyan: '#29B8DB',
  green:'#23D18B',
  yell: '#F5F543',
  red:  '#F14C4C',
  gray: '#767676',
  white:'#FFFFFF',
};

const CH_W = 7.15;     // zmerena sirka znaku pri 13px Consolas (canvas measureText)
const LINE_H = 20;
const PAD_X = 16;
const TOP = 46;        // pod title barem
const STEP = 0.34;     // sekundy mezi radky
const TAIL = 3.2;      // pauza na konci cyklu

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build({ file, title, width, lines }) {
  const total = lines.length * STEP + TAIL;
  const height = TOP + lines.length * LINE_H + 18;

  const body = lines.map((ln, i) => {
    const delay = (i * STEP).toFixed(2);
    const y = TOP + i * LINE_H;
    const color = COL[ln.c || 'def'];
    const weight = ln.b ? ' font-weight="700"' : '';
    const text = esc(ln.t || '');
    // Kurzor se veze na konci posledniho radku
    const cursor = ln.cursor
      ? `<rect class="cur" x="${(PAD_X + text.length * CH_W + 1).toFixed(1)}" y="${y - 11}" width="8" height="15" fill="${COL.white}"/>`
      : '';
    return `  <g class="ln" style="animation-name:ln${i}">
    <text x="${PAD_X}" y="${y}" fill="${color}"${weight}>${text}</text>${cursor ? '\n    ' + cursor : ''}
  </g>`;
  }).join('\n');

  // Kazdy radek ma VLASTNI keyframes, ale stejnou delku cyklu. S animation-delay
  // + infinite by kazdy radek bezel svuj vlastni cyklus a uz po prvnim pruchodu
  // by se rozesly z faze - misto vypisovani by jen nesynchronne blikaly.
  const frames = lines.map((ln, i) => {
    const start = (i * STEP) / total * 100;
    const lit = Math.min(start + 0.8, 95);
    return `    @keyframes ln${i} { 0%, ${start.toFixed(2)}% { opacity: 0 } ${lit.toFixed(2)}%, 96% { opacity: 1 } 100% { opacity: 0 } }`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
  <style>
    text { font-family: Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace; font-size: 13px; white-space: pre; }
    /* Vychozi stav je VIDITELNY, ne skryty. Kdyz se animace neprehraje
       (GitHub sanitizuje CSS v SVG, tisk, screenshot, nahled), zustane
       cely prepis citelny misto prazdneho okna. Animace pak jen rizne
       radky odhaluje - neni podminkou toho, aby slo neco precist. */
    .ln { opacity: 1; animation-duration: ${total.toFixed(2)}s; animation-timing-function: linear; animation-iteration-count: infinite; }
${frames}
    .cur { animation: blink 1s steps(1) infinite; }
    @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .ln { opacity: 1; animation: none !important; }
      .cur { animation: none; }
    }
  </style>
  <rect width="${width}" height="${height}" rx="8" fill="#012456"/>
  <rect width="${width}" height="30" rx="8" fill="#1F3B6E"/>
  <rect y="22" width="${width}" height="8" fill="#1F3B6E"/>
  <text x="${PAD_X}" y="20" fill="#D6E0F5" font-size="12">${esc(title)}</text>
  <g>
${body}
  </g>
</svg>
`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, svg, 'utf8');
  console.log(`${file}  (${lines.length} lines, ${total.toFixed(1)}s loop)`);
}

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node build-terminal-svg.mjs <output-dir>'); process.exit(1); }

const P = { t: '', c: 'def' };

// ---------------------------------------------------------------- 1
build({
  file: join(OUT, 'set-sharing-capability.svg'),
  title: 'Administrator: Windows PowerShell',
  width: 880,
  lines: [
    { t: 'PS C:\\> .\\Set-SiteSharingCapability.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com `', c: 'white' },
    { t: '>>     -All -SharingCapability ExistingExternalUserSharingOnly -WhatIf', c: 'white' },
    P,
    { t: '*** This script CHANGES external sharing settings. Run with -WhatIf first. ***', c: 'red', b: 1 },
    { t: 'Connecting to https://contoso-admin.sharepoint.com ...', c: 'cyan' },
    { t: 'Tenant ceiling: ExternalUserSharingOnly', c: 'cyan' },
    { t: 'Retrieving site collections ...', c: 'cyan' },
    { t: '110 site(s) in scope.', c: 'cyan' },
    { t: 'Backup written to .\\SharingCapability_Backup_20260901-101500.csv', c: 'green' },
    P,
    { t: 'What if: Performing the operation "Set sharing to' },
    { t: 'ExistingExternalUserSharingOnly (was ExternalUserSharingOnly)" on target' },
    { t: '"https://contoso.sharepoint.com/sites/projects".' },
    { t: '  skipped  https://contoso.sharepoint.com/sites/archive   already at target', c: 'gray' },
    { t: '  SKIPPED  https://contoso.sharepoint.com/sites/legal     site is locked (ReadOnly)', c: 'yell' },
    P,
    { t: 'Changed : 0', c: 'cyan' },
    { t: 'Skipped : 13 (11 already at target, 2 locked)', c: 'cyan' },
    { t: 'FAILED  : 0', c: 'cyan' },
    P,
    { t: 'PS C:\\> ', c: 'white', cursor: 1 },
  ],
});

// ---------------------------------------------------------------- 2
build({
  file: join(OUT, 'set-default-link-permission.svg'),
  title: 'Administrator: Windows PowerShell',
  width: 880,
  lines: [
    { t: 'PS C:\\> .\\Set-SiteDefaultLinkPermission.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com `', c: 'white' },
    { t: '>>     -All -DefaultLinkPermission View -MaxSites 200', c: 'white' },
    P,
    { t: '*** This script CHANGES sharing defaults. Run with -WhatIf first. ***', c: 'red', b: 1 },
    { t: 'Tenant default link permission: Edit', c: 'cyan' },
    { t: '110 site(s) in scope.', c: 'cyan' },
    { t: 'Backup written to .\\DefaultLinkPermission_Backup_20260901-101500.csv', c: 'green' },
    P,
    { t: '  changed  https://contoso.sharepoint.com/sites/projects  Edit -> View', c: 'green' },
    { t: '  changed  https://contoso.sharepoint.com/sites/finance   Edit -> View', c: 'green' },
    { t: '  skipped  https://contoso.sharepoint.com/sites/wiki      already View', c: 'gray' },
    { t: '  SKIPPED  https://contoso.sharepoint.com/sites/archive   sharing is Disabled -', c: 'yell' },
    { t: '                                                          setting would have no effect', c: 'yell' },
    P,
    { t: 'Changed : 88', c: 'cyan' },
    { t: 'Skipped : 22 (14 already at target, 6 sharing disabled, 2 locked)', c: 'cyan' },
    { t: 'FAILED  : 0', c: 'cyan' },
    P,
    { t: 'PS C:\\> ', c: 'white', cursor: 1 },
  ],
});

// ---------------------------------------------------------------- 3
build({
  file: join(OUT, 'set-access-request-settings.svg'),
  title: 'Administrator: Windows PowerShell',
  width: 880,
  lines: [
    { t: 'PS C:\\> .\\Set-SiteAccessRequestSettings.ps1 `', c: 'white' },
    { t: '>>     -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 0000... `', c: 'white' },
    { t: '>>     -AllowAccessRequests $true -AccessRequestEmail helpdesk@contoso.com `', c: 'white' },
    { t: '>>     -CustomMessage "Tell us which project you need."', c: 'white' },
    P,
    { t: '*** This script CHANGES site access request settings. Run with -WhatIf first. ***', c: 'red', b: 1 },
    { t: 'Backup written to .\\AccessRequestSettings_Backup_20260901-101500.csv', c: 'green' },
    P,
    { t: 'https://contoso.sharepoint.com/sites/projects', c: 'cyan' },
    { t: '  current  MembersCanShare=True  MembersCanInvite=True' },
    { t: '           AccessRequests=owners group  Message=(none)' },
    { t: '  tenant   member sharing override: Unspecified (not overridden)', c: 'gray' },
    { t: '  changed  access requests -> helpdesk@contoso.com', c: 'green' },
    { t: '  changed  custom message set (31 chars)', c: 'green' },
    P,
    { t: 'Changed : 2 setting(s) across 1 site(s)', c: 'cyan' },
    { t: 'Skipped : 0', c: 'cyan' },
    { t: 'FAILED  : 0', c: 'cyan' },
    P,
    { t: 'PS C:\\> ', c: 'white', cursor: 1 },
  ],
});
