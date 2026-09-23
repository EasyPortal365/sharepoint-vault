// Kontrola konzistence vaultu. Spousti se pred commitem (u spravce repa ji
// pousti lokalni pre-commit hook, ale jde spustit i rucne):
//
//   node tools/check-vault.mjs
//
// Hlida to, co se tise rozejde: obsah slozek proti tomu, co o nem tvrdi
// indexy (sekcni README, INDEX.md, postranni menu _sidebar.md), format clanku
// (frontmatter + dvojjazycna bottom line) a natvrdo napsane pocty, ktere nikdo
// neaktualizuje.
// Exit 1 = nalezeno rozcházeni.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

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
  console.log(chyb ? 'check-vault --selftest: SELHAL' : 'check-vault --selftest: OK (9 tvrzeni vcetne obou polarit)');
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

// ── 2d. Format clanku: frontmatter + dvojjazycna bottom line ─────────────
// Dva clanky bez frontmatteru prosly indexy i odkazy, protoze na format se
// nic neptalo. Snippety maji vlastni format (dvouradkovy uvod), README jsou vyjimka.
for (const f of [...gotchas, ...guides]) {
  const chybi = chybiVeFormatu(read(f));
  if (chybi.length) problems.push(`${f}: chybi ${chybi.join(', ')} (format viz CONTRIBUTING.md)`);
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
