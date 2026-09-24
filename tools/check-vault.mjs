// Kontrola konzistence vaultu. Spousti se pred commitem (u spravce repa ji
// pousti lokalni pre-commit hook, ale jde spustit i rucne):
//
//   node tools/check-vault.mjs
//
// Hlida to, co se tise rozejde: obsah slozek proti tomu, co o nem tvrdi
// indexy (sekcni README, INDEX.md, postranni menu _sidebar.md), format clanku
// (frontmatter + dvojjazycna bottom line) a natvrdo napsane pocty, ktere nikdo
// neaktualizuje. Generovane casti indexu (tools/build-index.mjs) musi presne
// odpovidat frontmatteru clanku. Varuje (bez exit 1), kdyz byl clanek commitnut
// o vic nez 30 dni pozdeji, nez rika jeho last-reviewed.
// Exit 1 = nalezeno rozcházeni.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diskFs, vygeneruj, rozdily } from './build-index.mjs';

// Prepinace (--selftest) NEJSOU cesta. Bez tohohle filtru se prepinac vzal jako ROOT,
// walk() nenasel nic a selftest merl prazdny strom misto vaultu.
const ARGY = process.argv.slice(2).filter((a) => a.indexOf('--') !== 0);
const ROOT = resolve(ARGY[0] || '.');
const problems = [];
const notes = [];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

/** Sekce, ktere v repu MUSI byt — jejich zmizeni je nalez, ne prazdny vysledek. */
const POVINNE_SEKCE = ['scripts', 'gotchas', 'guides', 'snippets', 'talks'];
const chybejiciSekce = [];

function walk(dir, filter, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) {
    // Tiche `[]` u chybejici slozky delalo z prejmenovane sekce „nic k hlaseni":
    // pocty sedely, mrtve odkazy se nekontrolovaly a skript vypsal OK.
    if (POVINNE_SEKCE.indexOf(dir.split('/')[0]) !== -1) chybejiciSekce.push(dir);
    return out;
  }
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, filter, out);
    else if (filter(e.name)) out.push(rel);
  }
  return out;
}

/** Soubory (cesty), jejichz jmeno se v textu indexu nevyskytuje. */
function chybiV(soubory, text) {
  return soubory.filter((f) => !text.includes(f.split('/').pop()));
}

/**
 * Format clanku (CONTRIBUTING): frontmatter + dvojjazycna bottom line hned pod H1.
 * Vraci seznam chybejicich casti — prazdny = v poradku.
 */
function chybiVeFormatu(text) {
  const out = [];
  const t = text.replace(/^\uFEFF/, '');
  if (!/^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(t)) out.push('frontmatter');
  else if (!/^last-reviewed:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(t.split(/\r?\n---\r?\n/)[0])) out.push('last-reviewed');
  if (!/^> \*\*Bottom line\.\*\*/m.test(t)) out.push('Bottom line');
  if (!/^> \*\*Ve zkratce\.\*\*/m.test(t)) out.push('Ve zkratce');
  return out;
}

/**
 * PowerShell 5.1 cte .ps1 bez BOM jako ANSI: z pomlcky „—" (bajty E2 80 94) je „â€”" a jeho
 * posledni bajt (0x94 = pravá uvozovka) PowerShell bere jako konec retezce - skript spadne
 * uz na parseru. Ukazky PowerShellu v clancich se kopiruji do .ps1, proto v nich typograficke
 * pomlcky ani uvozovky nemaji co delat. Vraci cisla radku.
 */
const TYPO_ZNAKY = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x201e, 0x201f].map((k) => String.fromCharCode(k)).join('');
const TYPO = new RegExp(`[${TYPO_ZNAKY}]`);
/** Clanky, ktere typograficke znaky v PowerShellu ukazuji ZAMERNE (je to jejich tema). */
const TYPO_VYJIMKY = ['gotchas/powershell/smart-quotes-are-string-delimiters.md'];
function typoVPowerShellu(text) {
  const radky = [];
  let jazyk = null;
  String(text).split(/\r?\n/).forEach((l, i) => {
    const plot = /^\s*(```|~~~)\s*([\w+-]*)/.exec(l);
    if (plot) { jazyk = jazyk === null ? plot[2].toLowerCase() : null; return; }
    if (jazyk !== null && /^(powershell|ps1|ps|pwsh|posh)$/.test(jazyk) && TYPO.test(l)) radky.push(i + 1);
  });
  return radky;
}

/**
 * Revize, ktera nesedi s historii: posledni VECNY commit clanku je o vic nez `lhuta` dni
 * novejsi nez jeho last-reviewed. Vstup: [{ f, revize }], Map soubor -> datum.
 * Clanek bez revize nebo bez commitu (novy, jen ve stagingu) se nehlasi.
 *
 * PROC „vecny" a ne kazdy commit: plosna typograficka oprava (ceske uvozovky v bottom line,
 * 2 radky) nebo zmena frontmatteru (summary pro index) sahne na desitky clanku najednou;
 * doslovne pravidlo pak hlasilo 46 clanku a po migraci indexu by hlasilo skoro vsechny -
 * varovani, ktere vidi porad, nikdo necte. Vecny = vic nez LIMIT_RADKU zmenenych radku
 * mimo frontmatter, tj. vic nez dve prepsane vety (typografie + pridany odkaz = 4 radky).
 */
const LHUTA_REVIZE_DNI = 30;
const LIMIT_RADKU = 4;

/**
 * Z vystupu `git log -p -U0 --format=@<datum>` (nejnovejsi prvni) vrati Map soubor -> datum
 * posledniho vecneho commitu. Radky frontmatteru (`klic: hodnota`, `---`) se nepocitaji.
 */
function posledniVecneZmeny(log, limit = LIMIT_RADKU) {
  const mapa = new Map();
  let datum = '';
  let soubor = null;
  let vHunku = false;
  let pocty = new Map();
  const uzavri = () => {
    for (const [f, n] of pocty) if (n > limit && !mapa.has(f)) mapa.set(f, datum);
    pocty = new Map();
  };
  for (const l of log.split(/\r?\n/)) {
    if (l.startsWith('@') && /^@\d{4}-\d{2}-\d{2}$/.test(l)) { uzavri(); datum = l.slice(1); soubor = null; continue; }
    const d = /^diff --git a\/.+? b\/(.+)$/.exec(l);
    if (d) { soubor = d[1]; vHunku = false; continue; }
    if (!soubor) continue;
    if (l.startsWith('@@')) { vHunku = true; continue; }
    if (!vHunku) continue; // hlavicky souboru (index, ---, +++)
    if (!/^[+-]/.test(l)) continue;
    if (/^[+-](?:---\s*$|[A-Za-z][\w-]*:(?:\s|$))/.test(l)) continue; // frontmatter
    pocty.set(soubor, (pocty.get(soubor) || 0) + 1);
  }
  uzavri();
  return mapa;
}
function zastaraleRevize(clanky, commity, lhuta = LHUTA_REVIZE_DNI) {
  const den = (s) => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const out = [];
  for (const { f, revize } of clanky) {
    const c = commity.get(f);
    if (!revize || !c || isNaN(den(revize)) || isNaN(den(c))) continue;
    const dni = Math.round(den(c) - den(revize));
    if (dni > lhuta) out.push({ f, revize, commit: c, dni });
  }
  return out;
}

/**
 * Soubor -> datum jeho posledniho vecneho commitu (YYYY-MM-DD), jednim pruchodem historie.
 * Pre-commit hook meri kopii indexu v docasne slozce bez .git, proto druhy pokus
 * v repozitari, ve kterem lezi tenhle skript. null = git neni k dispozici (neni co merit).
 */
function datumyPoslednichCommitu() {
  const kandidati = [ROOT, resolve(dirname(fileURLToPath(import.meta.url)), '..')];
  for (const kde of kandidati) {
    try {
      const top = execFileSync('git', ['-C', kde, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (!existsSync(join(top, 'tools', 'check-vault.mjs'))) continue;
      const log = execFileSync('git', ['-C', top, 'log', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-renames',
        '--format=@%cd', '--date=short', '--', 'gotchas', 'guides', 'snippets', 'course'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
      return posledniVecneZmeny(log);
    } catch { /* dalsi kandidat */ }
  }
  return null;
}

/**
 * PROTIPŘÍKLAD (`--selftest`): chybějící sekce se MUSÍ ohlásit, existující ne.
 * Přesně tahle díra tu byla — `walk()` vracel tiché `[]` a přejmenovaná sekce se
 * proměnila v „nic k hlášení".
 */
if (process.argv.indexOf('--selftest') !== -1) {
  let chyb = 0;
  // Indexy: chybejici polozka se ohlasi, uvedena ne.
  const idx = chybiV(['guides/a.md', 'guides/b.md'], '| [A](a.md) |');
  if (idx.length !== 1 || idx[0] !== 'guides/b.md') { console.error('  x  selftest: chybiV neoznacil chybejici guide'); chyb++; }
  if (chybiV(['guides/a.md'], '[A](/guides/a.md)').length !== 0) { console.error('  x  selftest: chybiV hlasi uvedeny guide'); chyb++; }
  // Format: clanek bez frontmatteru a BLUF se ohlasi, uplny ne.
  const bez = chybiVeFormatu('# Title\n\n*Last reviewed: 2026-09-01*\n\n## Symptom\n');
  if (bez.indexOf('frontmatter') === -1 || bez.indexOf('Bottom line') === -1) { console.error('  x  selftest: clanek bez frontmatteru/BLUF prosel'); chyb++; }
  const plny = chybiVeFormatu('---\ntitle: x\nlast-reviewed: 2026-09-23\n---\n\n# X\n\n> **Bottom line.** a\n>\n> **Ve zkratce.** b\n');
  if (plny.length !== 0) { console.error('  x  selftest: uplny clanek hlasen jako vadny: ' + plny.join(', ')); chyb++; }
  const bezCs = chybiVeFormatu('---\nlast-reviewed: 2026-09-23\n---\n# X\n> **Bottom line.** a\n');
  if (bezCs.indexOf('Ve zkratce') === -1) { console.error('  x  selftest: chybejici ceska bottom line prosla'); chyb++; }
  const pred = walk('rozhodne-neexistujici-sekce', () => true).length;
  if (pred !== 0) { console.error('  x  selftest: neexistujici slozka vratila polozky'); chyb++; }
  if (chybejiciSekce.indexOf('rozhodne-neexistujici-sekce') !== -1) {
    console.error('  x  selftest: nepovinna sekce se zapsala mezi chybejici'); chyb++;
  }
  const skutecne = walk('gotchas', (n) => n.endsWith('.md'));
  if (skutecne.length === 0) { console.error('  x  selftest: gotchas/ je prazdna — merilo by se nic'); chyb++; }
  const stav = chybejiciSekce.length;
  walk('guides-podvrzeno-neexistuje', () => true);
  if (chybejiciSekce.length !== stav) { console.error('  x  selftest: cizi jmeno oznaceno za povinnou sekci'); chyb++; }
  // Revize proti historii: 31 dni se ohlasi; 30 dni a clanek bez commitu ne.
  const commity = new Map([['a.md', '2026-09-24'], ['b.md', '2026-09-24']]);
  const zr = zastaraleRevize([{ f: 'a.md', revize: '2026-08-24' }, { f: 'b.md', revize: '2026-08-25' }, { f: 'c.md', revize: '2020-01-01' }], commity);
  if (zr.length !== 1 || zr[0].f !== 'a.md' || zr[0].dni !== 31) { console.error('  x  selftest: zastaraleRevize nehlasi 31 dni, nebo hlasi 30 dni ci clanek bez commitu'); chyb++; }
  // Vecna zmena: frontmatter a dve prepsane vety se nepocitaji, pet radku textu ano.
  const log = ['@2026-09-24', '',
    'diff --git a/g/a.md b/g/a.md', 'index 1..2 100644', '--- a/g/a.md', '+++ b/g/a.md',
    '@@ -3 +3 @@', '-summary: old', '+summary: new', '@@ -10 +10 @@', '-> **Ve zkratce.** "x"', '+> **Ve zkratce.** x',
    'diff --git a/g/b.md b/g/b.md', '--- a/g/b.md', '+++ b/g/b.md', '@@ -20,0 +21,5 @@', '+one', '+two', '+three', '+four', '+five',
    '@2026-08-01', '',
    'diff --git a/g/a.md b/g/a.md', '--- a/g/a.md', '+++ b/g/a.md', '@@ -5,0 +6,5 @@', '+v', '+w', '+x', '+y', '+z'].join('\n');
  const vz = posledniVecneZmeny(log);
  if (vz.get('g/a.md') !== '2026-08-01') { console.error('  x  selftest: frontmatter nebo dve prepsane vety se pocitaji jako vecna zmena'); chyb++; }
  if (vz.get('g/b.md') !== '2026-09-24') { console.error('  x  selftest: petiradkova zmena textu se nepocita jako vecna'); chyb++; }
  // Git je k dispozici (vault je repozitar), jinak by se varovani tise nemerilo.
  const mapa = datumyPoslednichCommitu();
  if (!mapa || mapa.size === 0) { console.error('  x  selftest: datumy commitu nejdou precist - varovani o revizi by mlcelo'); chyb++; }
  // PowerShell: typograficka pomlcka v bloku powershell se ohlasi, stejna v bloku ts ne.
  const pomlcka = String.fromCharCode(0x2014);
  const tr = typoVPowerShellu(['```powershell', `Write-Host "a ${pomlcka} b"`, '```', '```ts', `const a = "${pomlcka}";`, '```'].join('\n'));
  if (tr.length !== 1 || tr[0] !== 2) { console.error('  x  selftest: pomlcka v ukazce PowerShellu se neohlasila, nebo se hlasi i mimo ni'); chyb++; }
  console.log(chyb ? 'check-vault --selftest: SELHAL' : 'check-vault --selftest: OK (14 tvrzeni vcetne obou polarit)');
  process.exit(chyb ? 1 : 0);
}

// ── 1. Kazdy skript je v sekcnim README i v INDEX.md ─────────────────────
const scripts = walk('scripts', (n) => n.endsWith('.ps1'));
const scriptsReadme = read('scripts/README.md');
const index = read('INDEX.md');

for (const s of scripts) {
  const name = s.split('/').pop();
  if (!scriptsReadme.includes(name)) problems.push(`scripts/README.md neuvadi ${name}`);
  if (!index.includes(name)) problems.push(`INDEX.md neuvadi ${name}`);
}

// ── 2. Kazda gotcha je v gotchas/README i v INDEX ────────────────────────
const gotchas = walk('gotchas', (n) => n.endsWith('.md') && n !== 'README.md');
const gotchasReadme = read('gotchas/README.md');
for (const g of gotchas) {
  const name = g.split('/').pop();
  if (!gotchasReadme.includes(name)) problems.push(`gotchas/README.md neuvadi ${name}`);
  if (!index.includes(name)) problems.push(`INDEX.md neuvadi ${name}`);
}

// ── 2b. Kazdy guide je v guides/README, v INDEX i v postrannim menu ──────
// Guides jsou v _sidebar.md vypsane jednotlive (na rozdil od gotchas/scripts,
// kde menu odkazuje jen na sekcni README) — chybejici radek = guide, ktery
// ctenar webu nenajde.
const guides = walk('guides', (n) => n.endsWith('.md') && n !== 'README.md');
const guidesReadme = read('guides/README.md');
const sidebar = has('_sidebar.md') ? read('_sidebar.md') : '';
if (!sidebar) problems.push('_sidebar.md chybi — postranni menu webu nejde zkontrolovat');
for (const g of chybiV(guides, guidesReadme)) problems.push(`guides/README.md neuvadi ${g.split('/').pop()}`);
for (const g of chybiV(guides, index)) problems.push(`INDEX.md neuvadi ${g.split('/').pop()}`);
if (sidebar) for (const g of chybiV(guides, sidebar)) problems.push(`_sidebar.md neuvadi ${g.split('/').pop()}`);

// ── 2c. Kapitoly kurzu jsou v INDEX i v postrannim menu ──────────────────
const kapitoly = walk('course', (n) => n.endsWith('.md') && n !== 'README.md');
for (const c of chybiV(kapitoly, index)) problems.push(`INDEX.md neuvadi ${c.split('/').pop()}`);
if (sidebar) for (const c of chybiV(kapitoly, sidebar)) problems.push(`_sidebar.md neuvadi ${c.split('/').pop()}`);
// course/README.md (cesky prehled kapitol) se negeneruje - proto se na nej ptame zvlast.
const kurzReadme = has('course/README.md') ? read('course/README.md') : '';
for (const c of chybiV(kapitoly, kurzReadme)) problems.push(`course/README.md neuvadi ${c.split('/').pop()}`);

// ── 2d. Format clanku: frontmatter + dvojjazycna bottom line ─────────────
// Dva clanky bez frontmatteru prosly indexy i odkazy, protoze na format se
// nic neptalo. Snippety maji vlastni format (dvouradkovy uvod), README jsou vyjimka.
for (const f of [...gotchas, ...guides]) {
  const chybi = chybiVeFormatu(read(f));
  if (chybi.length) problems.push(`${f}: chybi ${chybi.join(', ')} (format viz CONTRIBUTING.md)`);
}

// ── 2e. Generovane casti indexu odpovidaji frontmatteru ──────────────────
// INDEX.md a sekcni README (gotchas, guides, snippets) sklada tools/build-index.mjs
// z title/short-title/summary clanku. Rucni uprava generovane casti, clanek bez
// summary nebo frontmatter, ktery YAML precte jinak (GitHub pak misto tabulky ukaze
// chybu), se hlasi tady - jinak by se indexy zase tise rozjely.
const fsVaultu = diskFs(ROOT);
const generovano = vygeneruj(fsVaultu);
for (const c of generovano.chyby) problems.push(c);
if (!generovano.chyby.length) {
  for (const d of rozdily(fsVaultu, generovano.vystup)) {
    problems.push(`${d.rel}: generovana cast nesedi s frontmatterem clanku (radek ${d.radek}: je "${d.ma.slice(0, 70)}", `
      + `ma byt "${d.cekam.slice(0, 70)}") - spust node tools/build-index.mjs`);
  }
}

// ── 2f. PowerShell bez typografickych znaku (PS 5.1 a UTF-8 bez BOM) ─────
// Skripty ciste ASCII; ukazky PowerShellu v clancich bez typografickych pomlcek a uvozovek.
for (const s of scripts) {
  const radek = read(s).split(/\r?\n/).findIndex((l) => /[^\t -~]/.test(l));
  if (radek !== -1) problems.push(`${s}: radek ${radek + 1} neni ASCII - PowerShell 5.1 precte skript bez BOM jako ANSI a muze spadnout na parseru`);
}
for (const f of [...gotchas, ...guides, ...walk('snippets', (n) => n.endsWith('.md')), ...walk('course', (n) => n.endsWith('.md'))]) {
  if (TYPO_VYJIMKY.indexOf(f) !== -1) continue;
  const radky = typoVPowerShellu(read(f));
  if (radky.length) problems.push(`${f}: typograficka pomlcka nebo uvozovka v ukazce PowerShellu (radek ${radky.join(', ')}) - pis ASCII - a "`);
}

// ── 3. Natvrdo napsane pocty v textu ─────────────────────────────────────
// Cislo v prose zastara ve chvili, kdy pribude soubor. Bud musi sedet,
// nebo tam nema co delat.
const counts = {
  scripts: scripts.length,
  gotchas: gotchas.length,
  guides: guides.length,
  snippets: walk('snippets', (n) => n.endsWith('.md') && n !== 'README.md').length,
};

const NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const mdFiles = ['README.md', 'INDEX.md', 'scripts/README.md', 'gotchas/README.md', 'guides/README.md']
  .filter(has);

for (const f of mdFiles) {
  const text = read(f);
  // "20 new admin scripts", "Four scripts write", "94 gotchas"
  const re = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:new\s+|more\s+)?(?:admin\s+)?(scripts?|gotchas?|guides?|snippets?)\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].toLowerCase();
    const claimed = /^\d+$/.test(raw) ? parseInt(raw, 10) : NUM[raw];
    const kindWord = m[2].toLowerCase().replace(/s$/, '');
    const actual = counts[kindWord + 's'];
    if (claimed === undefined || actual === undefined) continue;
    // Tvrzeni o podmnozine ("four scripts write") nema sedet na celek -
    // hlasime jen kdyz cislo vypada jako pokus o celkovy pocet.
    if (claimed > actual) {
      problems.push(`${f}: tvrdi "${m[0].trim()}", ale ${kindWord}s je ${actual}`);
    } else if (claimed !== actual && claimed >= actual * 0.6) {
      notes.push(`${f}: "${m[0].trim()}" vs. skutecnych ${actual} ${kindWord}s - zastaralo?`);
    }
  }
}

// ── 4. Relativni odkazy v markdownu vedou na existujici soubor ───────────
const allMd = [
  ...walk('gotchas', (n) => n.endsWith('.md')),
  ...walk('scripts', (n) => n.endsWith('.md')),
  ...walk('guides', (n) => n.endsWith('.md')),
  ...walk('snippets', (n) => n.endsWith('.md')),
  ...walk('talks', (n) => n.endsWith('.md')),
  'README.md', 'INDEX.md', 'CONTRIBUTING.md', '_sidebar.md',
].filter(has);

// Odkaz uvnitr kodu neni odkaz - je to ukazka. Musi ven, jinak detektor
// hlasi `[label](url)` z prozy a regexy z JSON bloku jako mrtve cesty.
const stripCode = (s) => s
  .replace(/```[\s\S]*?```/g, '')
  .replace(/`[^`\n]*`/g, '');

for (const f of allMd) {
  const text = stripCode(read(f));
  const re = /\[[^\]]*\]\(([^)\s]+)(?:\s+'[^']*')?\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    const base = target.startsWith('/') ? ROOT : join(ROOT, dirname(f));
    const abs = target.startsWith('/') ? join(ROOT, target.slice(1)) : join(base, target);
    if (!existsSync(abs)) problems.push(`${f}: mrtvy odkaz -> ${m[1]}`);
  }
}

// ── 5. Zapisujici skripty vs. co o nich tvrdi README ─────────────────────
const writers = scripts.filter((s) => read(s).includes('SupportsShouldProcess'));
const writerClaim = scriptsReadme.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+scripts?\s+write/i);
if (writerClaim) {
  const raw = writerClaim[1].toLowerCase();
  const claimed = /^\d+$/.test(raw) ? parseInt(raw, 10) : NUM[raw];
  if (claimed !== writers.length) {
    problems.push(`scripts/README.md tvrdi "${writerClaim[0]}", ale zapisujicich skriptu je ${writers.length}: ${writers.map((w) => w.split('/').pop()).join(', ')}`);
  }
}

// ── 6. last-reviewed proti historii (jen varovani) ───────────────────────
// Clanek, ktery se v gitu menil o vic nez 30 dni pozdeji, nez rika jeho last-reviewed,
// nejspis prosel zmenou bez nove revize - datum pak ctenari slibuje cerstvost, ktera
// neplati. Varovani, ne chyba: typograficka oprava revizi nevyzaduje.
const commity = datumyPoslednichCommitu();
if (!commity) {
  notes.push('last-reviewed proti historii se nemerilo - git neni k dispozici');
} else {
  const clankySRevizi = [...gotchas, ...guides, ...kapitoly, ...walk('snippets', (n) => n.endsWith('.md') && n !== 'README.md')]
    .map((f) => ({ f, revize: (/^last-reviewed:\s*(\d{4}-\d{2}-\d{2})\s*$/m.exec(read(f).split(/\r?\n---\r?\n/)[0]) || [])[1] }));
  for (const z of zastaraleRevize(clankySRevizi, commity)) {
    notes.push(`${z.f}: posledni vecna zmena ${z.commit} je o ${z.dni} dni novejsi nez last-reviewed ${z.revize} - projdi clanek a posun last-reviewed`);
  }
}

// ── vysledek ─────────────────────────────────────────────────────────────
console.log(`scripts: ${counts.scripts} | gotchas: ${counts.gotchas} | guides: ${counts.guides} | snippets: ${counts.snippets} | writing scripts: ${writers.length}\n`);

for (const n of notes) console.log(`  ? ${n}`);
if (notes.length) console.log('');

if (problems.length === 0) {
  console.log('OK - indexy sedi s obsahem, zadne mrtve odkazy.');
  process.exit(0);
}
console.log(`NALEZENO ${problems.length} rozchazeni:`);
for (const p of problems) console.log(`  x ${p}`);

if (chybejiciSekce.length) {
  console.error('CHYBA: chybi sekce ' + chybejiciSekce.join(', ') + ' — meridlo je rozbite, ne vault cisty.');
  process.exit(1);
}
process.exit(1);
