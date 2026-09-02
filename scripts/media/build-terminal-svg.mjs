// Generator animovanych SVG "terminalu" pro vault.
//
// Prubeh: administrator napise prikaz po slovech, odentruje, pak se vypisuje
// vystup radek po radku. Animace probehne JEDNOU a zustane stat na hotovem
// prepisu (animation-fill-mode: forwards) - neopakuje se.
//
// Proc jednorazove: pri `infinite` bezel kazdy prvek vlastni cyklus a uz po
// prvnim pruchodu se rozesly z faze - misto vypisovani jen nesynchronne
// blikaly. S jednim pruchodem staci animation-delay a nic se nerozejde.
//
// CSS je uvnitr SVG, takze animace funguje i kdyz je soubor vlozeny jako <img>.
// Kdyz se CSS neuplatni vubec (GitHub ho z SVG odstranuje, tisk, nahled),
// zustanou prvky na sve vychozi SVG neprusvitnosti = cely prepis je citelny.
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

const CH_W   = 7.15;   // zmerena sirka znaku pri 13px Consolas (canvas measureText)
const LINE_H = 20;
const PAD_X  = 16;
const TOP    = 46;     // pod title barem

const TYPE_STEP    = 0.17;  // sekundy na jedno napsane slovo
const ENTER_PAUSE  = 0.5;   // pauza mezi Enterem a prvnim vystupem
const OUT_STEP     = 0.13;  // sekundy na radek vystupu
const BLANK_STEP   = 0.05;  // prazdny radek vystupu jde rychleji

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Rozdeli radek na tokeny tak, ze mezera patri k predchozimu slovu -
// diky tomu sedi kumulativni offsety na sirku znaku.
function tokenize(line) {
  const out = [];
  const re = /\S+\s*/g;
  let m;
  while ((m = re.exec(line)) !== null) out.push(m[0]);
  return out;
}

function build({ file, title, width, command, output }) {
  const cmdLines = Array.isArray(command) ? command : [command];

  // --- rozlozeni prikazu na tokeny s casem a pozici -----------------------
  let t = 0;
  const tokens = [];
  const caretStops = [];   // [cas, x, y] kam kurzor skoci po napsani tokenu

  cmdLines.forEach((line, li) => {
    const y = TOP + li * LINE_H;
    let col = 0;
    for (const tok of tokenize(line)) {
      const x = PAD_X + col * CH_W;
      tokens.push({ text: tok, x, y, at: t });
      col += tok.length;
      t += TYPE_STEP;
      caretStops.push({ at: t, x: PAD_X + col * CH_W, y });
    }
  });

  const enterAt = t;
  t += ENTER_PAUSE;

  // --- vystupni radky -----------------------------------------------------
  const outStart = TOP + cmdLines.length * LINE_H;
  const outRows = output.map((ln, i) => {
    const row = { ...ln, y: outStart + i * LINE_H, at: t };
    t += (ln.t && ln.t.length) ? OUT_STEP : BLANK_STEP;
    return row;
  });

  const finalCaretY = outStart + output.length * LINE_H;
  const endAt = t + 0.2;
  const height = finalCaretY + 26;

  // --- SVG ----------------------------------------------------------------
  const cmdSvg = tokens.map((tok, i) =>
    `    <text class="tok" style="animation-delay:${tok.at.toFixed(2)}s" x="${tok.x.toFixed(1)}" y="${tok.y}" fill="${COL.white}">${esc(tok.text)}</text>`
  ).join('\n');

  const outSvg = outRows.filter(r => r.t).map(r =>
    `    <text class="tok" style="animation-delay:${r.at.toFixed(2)}s" x="${PAD_X}" y="${r.y}" fill="${COL[r.c || 'def']}"${r.b ? ' font-weight="700"' : ''}>${esc(r.t)}</text>`
  ).join('\n');

  // Kurzor pri psani: skace po koncich slov, po Enteru zmizi.
  const caretFrames = caretStops.map(s => {
    const pct = (s.at / endAt * 100).toFixed(2);
    return `      ${pct}% { transform: translate(${(s.x - PAD_X).toFixed(1)}px, ${(s.y - TOP).toFixed(0)}px); }`;
  }).join('\n');
  const enterPct = (enterAt / endAt * 100).toFixed(2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
  <style>
    text { font-family: Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace; font-size: 13px; white-space: pre; }

    /* Kazdy prvek se objevi jednou a zustane. Bez CSS (GitHub, tisk) plati
       vychozi SVG neprusvitnost, takze je videt cely prepis. */
    .tok { opacity: 0; animation: show 0.01s linear forwards; }
    @keyframes show { to { opacity: 1 } }

    .caret { animation: caret ${endAt.toFixed(2)}s steps(1) forwards, blink 1s steps(1) ${enterPct}; }
    @keyframes caret {
${caretFrames}
      ${enterPct}%, 100% { opacity: 0; }
    }
    .caret-end { opacity: 0; animation: show 0.01s linear ${(endAt - 0.15).toFixed(2)}s forwards, blink 1s steps(1) ${(endAt - 0.15).toFixed(2)}s infinite; }
    @keyframes blink { 0%, 50% { opacity: 1 } 51%, 100% { opacity: 0 } }

    @media (prefers-reduced-motion: reduce) {
      .tok, .caret-end { opacity: 1; animation: none !important; }
      .caret { display: none; }
    }
  </style>
  <rect width="${width}" height="${height}" rx="8" fill="#012456"/>
  <rect width="${width}" height="30" rx="8" fill="#1F3B6E"/>
  <rect y="22" width="${width}" height="8" fill="#1F3B6E"/>
  <text x="${PAD_X}" y="20" fill="#D6E0F5" font-size="12">${esc(title)}</text>

${cmdSvg}
${outSvg}

  <rect class="caret" x="${PAD_X}" y="${TOP - 11}" width="8" height="15" fill="${COL.white}"/>
  <rect class="caret-end" x="${PAD_X}" y="${finalCaretY - 11}" width="8" height="15" fill="${COL.white}"/>
  <text class="tok" style="animation-delay:${(endAt - 0.15).toFixed(2)}s" x="${PAD_X}" y="${finalCaretY}" fill="${COL.white}">PS C:\\&gt;</text>
</svg>
`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, svg, 'utf8');
  console.log(`${file}  (${tokens.length} words typed, ${output.length} output lines, ${endAt.toFixed(1)}s once)`);
}

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node build-terminal-svg.mjs <output-dir>'); process.exit(1); }

const P = { t: '' };

// ---------------------------------------------------------------- 1
build({
  file: join(OUT, 'set-sharing-capability.svg'),
  title: 'Administrator: Windows PowerShell',
  width: 880,
  command: [
    'PS C:\\> .\\Set-SiteSharingCapability.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com `',
    '>>     -All -SharingCapability ExistingExternalUserSharingOnly -WhatIf',
  ],
  output: [
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
  ],
});

// ---------------------------------------------------------------- 2
build({
  file: join(OUT, 'set-default-link-permission.svg'),
  title: 'Administrator: Windows PowerShell',
  width: 880,
  command: [
    'PS C:\\> .\\Set-SiteDefaultLinkPermission.ps1 -TenantAdminUrl https://contoso-admin.sharepoint.com `',
    '>>     -All -DefaultLinkPermission View -MaxSites 200',
  ],
  output: [
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
  ],
});

// ---------------------------------------------------------------- 3
build({
  file: join(OUT, 'set-access-request-settings.svg'),
  title: 'Administrator: Windows PowerShell',
  width: 880,
  command: [
    'PS C:\\> .\\Set-SiteAccessRequestSettings.ps1 `',
    '>>     -SiteUrl https://contoso.sharepoint.com/sites/projects -ClientId 0000... `',
    '>>     -AllowAccessRequests $true -AccessRequestEmail helpdesk@contoso.com `',
    '>>     -CustomMessage "Tell us which project you need."',
  ],
  output: [
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
  ],
});
