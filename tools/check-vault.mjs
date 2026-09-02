// Kontrola konzistence vaultu. Spousti se rucne pred commitem:
//
//   node tools/check-vault.mjs
//
// Hlida to, co se tise rozejde: obsah slozek proti tomu, co o nem tvrdi
// indexy, a natvrdo napsane pocty, ktere nikdo neaktualizuje.
// Exit 1 = nalezeno rozcházeni.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || '.');
const problems = [];
const notes = [];

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const has = (p) => existsSync(join(ROOT, p));

function walk(dir, filter, out = []) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, filter, out);
    else if (filter(e.name)) out.push(rel);
  }
  return out;
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

// ── 3. Natvrdo napsane pocty v textu ─────────────────────────────────────
// Cislo v prose zastara ve chvili, kdy pribude soubor. Bud musi sedet,
// nebo tam nema co delat.
const counts = {
  scripts: scripts.length,
  gotchas: gotchas.length,
  guides: walk('guides', (n) => n.endsWith('.md') && n !== 'README.md').length,
  snippets: walk('snippets', (n) => n.endsWith('.md') && n !== 'README.md').length,
};

const NUM = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const mdFiles = ['README.md', 'INDEX.md', 'scripts/README.md', 'gotchas/README.md']
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
  'README.md', 'INDEX.md', 'CONTRIBUTING.md',
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
process.exit(1);
