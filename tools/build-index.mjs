// Generator indexu vaultu z frontmatteru clanku.
//
//   node tools/build-index.mjs             prepise generovane casti (jen soubory, ktere se lisi)
//   node tools/build-index.mjs --check     nic nezapise; exit 1, kdyz generovane casti nesedi
//   node tools/build-index.mjs --selftest  protipriklady obou polarit
//   (volitelne jako prvni argument koren vaultu; vychozi = slozka nad tools/)
//
// ZDROJ PRAVDY je frontmatter kazdeho clanku v gotchas/, guides/, snippets/ a course/:
//   title        nazev clanku (povinny)
//   short-title  kratsi text odkazu v indexech (volitelny; jinak se pouzije title)
//   summary      jedna radka Markdownu - popis v INDEX.md i v tabulce sekcniho README (povinny)
//
// CO SE GENERUJE (rucni zasah prepise pristi beh a check-vault ho hlasi jako rozchazeni):
//   INDEX.md             polozky pod radky sekci gotchas/, guides/, course/, snippets/ a radek
//                        "*Last updated: ...*" (nejnovejsi last-reviewed ze clanku)
//   <sekce>/README.md    cast "## Index" u gotchas, guides a snippets (nadpisy kategorii + tabulky)
// Rucni zustava: uvodni radek kazde sekce v INDEX.md, sekce scripts/, talks/, templates/,
// resources/, odstavec mezi nadpisem kategorie a tabulkou v README, course/README.md
// (cesky prehled kapitol) a _sidebar.md.
//
// PORADI neni abecedni: bere se z dnesniho INDEX.md. Rucni kurace tak plati - staci presunout
// radek v INDEX.md a pustit generator, README se srovna podle nej. Novy clanek jde na konec
// sve kategorie, nova kategorie na konec sekce. Kategorii URCUJE SLOZKA, ne misto v INDEXu.
//
// PROC: indexy se psaly rucne na dvou mistech se dvema ruznymi popisy. Rozjizdely se - clanky
// pod cizi kategorii, jiny popis v README nez v INDEXu, chybejici radky - a kontrola umela
// rict jen "chybi", ne "je to jinak". Frontmatter navic musi byt platny YAML: GitHub ho
// vykresluje jako tabulku a u neplatneho ukaze misto ni chybu.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Sekce s generovanym obsahem. `kategorie` = clanky lezi v podslozkach (gotchas/rest-api/x.md). */
export const SEKCE = [
  { dir: 'gotchas', kategorie: true, tabulka: '| Gotcha | TL;DR |' },
  { dir: 'guides', kategorie: false, tabulka: '| Guide | What it covers |' },
  { dir: 'course', kategorie: false, tabulka: null }, // course/README.md je cesky a rucni
  { dir: 'snippets', kategorie: true, tabulka: '| Snippet | When to reach for it |' },
];

// ── Pristup k souborum: disk, nebo pamet (selftest) ──────────────────────
export function diskFs(root) {
  return {
    list(dir) {
      const out = [];
      const walk = (rel) => {
        const abs = join(root, rel);
        if (!existsSync(abs)) return;
        for (const e of readdirSync(abs, { withFileTypes: true })) {
          const r = `${rel}/${e.name}`;
          if (e.isDirectory()) walk(r);
          else if (e.name.endsWith('.md')) out.push(r);
        }
      };
      walk(dir);
      return out.sort();
    },
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    exists: (rel) => existsSync(join(root, rel)),
  };
}

export function memFs(files) {
  return {
    list: (dir) => Object.keys(files).filter((k) => k.startsWith(`${dir}/`) && k.endsWith('.md')).sort(),
    read: (rel) => {
      if (!(rel in files)) throw new Error(`ENOENT ${rel}`);
      return files[rel];
    },
    exists: (rel) => rel in files,
  };
}

// ── YAML: jen podmnozina, kterou vault pouziva ──────────────────────────
// Klic: hodnota na jednom radku. Hodnota je bud "JSON retezec", 'retezec' (apostrof uvnitr
// zdvojeny), [jednoduchy, seznam], nebo holy text, ktery YAML precte jako tentyz text.
// Holy text nesmi zacinat indikatorem YAML a nesmi obsahovat ": " ani " #" - presne
// na tom byly tri titulky, ktere GitHub nevykreslil.
const INDIKATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;
const zn = (kod) => String.fromCharCode(kod);
const RIDICI = new RegExp('[' + zn(0) + '-' + zn(0x1f) + zn(0x7f) + '-' + zn(0x9f) + zn(0x2028) + zn(0x2029) + ']');
const K_ESCAPOVANI = new RegExp('[' + zn(0x7f) + '-' + zn(0x9f) + zn(0x2028) + zn(0x2029) + ']', 'g');

export function holyTextOk(s) {
  return typeof s === 'string' && s.length > 0 && s === s.trim() && !INDIKATOR.test(s) &&
    !/:(\s|$)/.test(s) && !/\s#/.test(s) && !RIDICI.test(s);
}

// Holy text, ktery YAML precte jako jiny typ: logickou hodnotu, null, cislo (i sestkovou
// soustavu YAML 1.1 jako 1:30), datum. U textovych klicu (title, short-title, summary) by se
// na GitHubu zobrazilo neco jineho, nez autor napsal - proto se hlasi.
const JINY_TYP = [
  /^(?:true|false|yes|no|on|off|y|n|null|~)$/i,
  /^[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/,
  /^0x[0-9a-fA-F_]+$|^0b[01_]+$/,
  /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.\d*)?$/,
  /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt ].*)?$/,
  /^[-+]?\.(?:inf|Inf|INF)$|^\.(?:nan|NaN|NAN)$/,
];
export const jinyTyp = (s) => JINY_TYP.some((re) => re.test(s));
const TEXTOVE_KLICE = ['title', 'short-title', 'summary'];

/** Text -> hodnota do frontmatteru: holy, kdyz ho YAML precte beze zmeny, jinak JSON retezec. */
export function yamlText(s) {
  if (holyTextOk(s) && !jinyTyp(s)) return s;
  return JSON.stringify(s).replace(K_ESCAPOVANI, (c) => zn(92) + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0')); // zn(92) = zpetne lomitko
}

function hodnota(raw) {
  if (raw === '') return { value: '' };
  if (raw[0] === '"') {
    let v;
    try { v = JSON.parse(raw); } catch { v = undefined; }
    if (typeof v !== 'string') return { chyba: 'text v uvozovkach neni platny - pis ho jako JSON retezec (uvnitr \\" a \\\\)' };
    if (raw.indexOf(zn(0x2028)) !== -1 || raw.indexOf(zn(0x2029)) !== -1) return { chyba: 'text obsahuje oddelovac radku U+2028/U+2029 - YAML ho bere jako konec radku' };
    return { value: v };
  }
  if (raw[0] === "'") {
    const m = /^'((?:[^']|'')*)'$/.exec(raw);
    return m ? { value: m[1].replace(/''/g, "'") } : { chyba: "text v apostrofech neni uzavreny (apostrof uvnitr se pise zdvojene: '')" };
  }
  if (raw[0] === '[') {
    const m = /^\[([^[\]{}]*)\]$/.exec(raw);
    if (!m) return { chyba: 'seznam [...] smi obsahovat jen jednoduche polozky oddelene carkou' };
    const polozky = m[1].split(',').map((x) => x.trim());
    if (polozky.length === 1 && polozky[0] === '') return { value: [] };
    const spatna = polozky.find((x) => !holyTextOk(x));
    if (spatna !== undefined) return { chyba: `polozka seznamu "${spatna}" neni holy text` };
    return { value: polozky };
  }
  if (!holyTextOk(raw)) return { chyba: 'hodnotu by YAML precetl jinak (zacina indikatorem nebo obsahuje ": " ci " #") - obal ji do "..."' };
  return { value: raw };
}

/** Frontmatter -> { data, chyby }. `data` je null, kdyz frontmatter chybi uplne. */
export function frontmatter(text) {
  const t = String(text).replace(new RegExp('^' + zn(0xfeff)), '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(t);
  if (!m) return { data: null, chyby: ['chybi frontmatter (--- ... --- na zacatku souboru)'] };
  const data = Object.create(null);
  const chyby = [];
  m[1].split(/\r?\n/).forEach((radek, i) => {
    if (radek.trim() === '' || /^\s*#/.test(radek)) return;
    const kv = /^([A-Za-z][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/.exec(radek);
    if (!kv) { chyby.push(`frontmatter, radek ${i + 2}: neni "klic: hodnota" na jednom radku`); return; }
    const [, klic, raw = ''] = kv;
    if (klic in data) chyby.push(`frontmatter: klic ${klic} je tam dvakrat`);
    const h = hodnota(raw);
    if (h.chyba) chyby.push(`frontmatter ${klic}: ${h.chyba}`);
    else if (TEXTOVE_KLICE.includes(klic) && !/^["'[]/.test(raw) && jinyTyp(raw)) {
      chyby.push(`frontmatter ${klic}: YAML by hodnotu precetl jako cislo, datum nebo logickou hodnotu - obal ji do "..."`);
    } else data[klic] = h.value;
  });
  return { data, chyby };
}

// ── Generovani ───────────────────────────────────────────────────────────
const odkazText = (d) => String(d['short-title'] || d.title || '');
const bezKodu = (s) => s.replace(/`[^`]*`/g, '');
// Odkaz v radku indexu; text odkazu smi obsahovat `kod` s hranatymi zavorkami (PS7 `[ref]`).
const ODKAZ = /^\s+- \[((?:[^\]`]|`[^`]*`)*)\]\(([^)\s]+)\)/;
const bunka = (s) => s.replace(/\|/g, '\\|');

/** Clanky sekce s daty pro index; chyby jdou do `chyby`. README sekce jen, kdyz ma summary. */
function clankySekce(fs, sekce, chyby) {
  const out = [];
  for (const rel of fs.list(sekce.dir)) {
    const pod = rel.slice(sekce.dir.length + 1);
    const jeReadme = pod === 'README.md';
    if (!jeReadme && rel.endsWith('/README.md')) continue;
    const { data, chyby: ch } = frontmatter(fs.read(rel));
    if (jeReadme && !(data && data.summary)) continue;
    const kat = pod.includes('/') ? pod.slice(0, pod.lastIndexOf('/')) : '';
    const vlastni = ch.slice();
    if (data) {
      if (!data.title) vlastni.push('chybi title');
      if (!data.summary) vlastni.push('chybi summary (jedna radka popisu do INDEX.md a README)');
      else if (typeof data.summary !== 'string') vlastni.push('summary musi byt text');
      else if (/\]\(/.test(data.summary)) vlastni.push('summary nesmi obsahovat odkaz - relativni cesta by v INDEX.md a v README vedla jinam');
      if (/[[\]]/.test(bezKodu(odkazText(data)))) vlastni.push('text odkazu (short-title nebo title) smi mit [ ] jen uvnitr `kodu`');
    }
    if (sekce.kategorie && !kat && !jeReadme) vlastni.push(`clanek patri do podslozky kategorie (${sekce.dir}/<kategorie>/)`);
    for (const c of vlastni) chyby.push(`${rel}: ${c}`);
    if (vlastni.length || !data) continue;
    out.push({
      rel, kat, jeReadme,
      odkaz: odkazText(data),
      summary: data.summary,
      revize: /^\d{4}-\d{2}-\d{2}$/.test(String(data['last-reviewed'] || '')) ? data['last-reviewed'] : '',
    });
  }
  return out;
}

/** Radky sekce v INDEX.md: od radku za "- ... **[dir/](dir/)** ..." po dalsi radek nejvyssi urovne. */
function oblastIndexu(radky, dir) {
  const re = new RegExp(`^- .*\\*\\*\\[${dir}/\\]\\(${dir}/\\)\\*\\*`);
  const start = radky.findIndex((l) => re.test(l));
  if (start === -1) return null;
  let konec = start + 1;
  while (konec < radky.length && radky[konec].trim() !== '' && !/^(- |#)/.test(radky[konec])) konec++;
  return { start, konec };
}

/** Poradi kategorii a clanku, jak stoji v dnesni oblasti INDEXu. */
function poradiZIndexu(radky) {
  const kategorie = [];
  const poradi = new Map();
  for (const l of radky) {
    const k = /^\s+- \*\*(.+?)\/\*\*\s*$/.exec(l);
    if (k) { if (!kategorie.includes(k[1])) kategorie.push(k[1]); continue; }
    const o = ODKAZ.exec(l);
    if (o && !poradi.has(o[2])) poradi.set(o[2], poradi.size);
  }
  return { kategorie, poradi };
}

function seradit(clanky, poradi) {
  const klic = (c) => (c.jeReadme ? -1 : poradi.has(c.rel) ? poradi.get(c.rel) : Infinity);
  return clanky.slice().sort((a, b) => klic(a) - klic(b) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Rucni odstavce mezi nadpisem kategorie (### x/) a tabulkou - generator je zachova. */
function rucniText(radky, rel, chyby) {
  const text = {};
  let kat = '';
  let stav = 'pred';
  for (const l of radky) {
    const h = /^###\s+(.+?)\/?\s*$/.exec(l);
    if (h) { kat = h[1]; stav = 'pred'; continue; }
    if (/^\s*\|/.test(l)) { stav = 'tabulka'; continue; }
    if (l.trim() === '') { if (stav === 'tabulka') stav = 'za'; continue; }
    if (stav === 'pred') (text[kat] = text[kat] || []).push(l);
    else chyby.push(`${rel}: text "${l.slice(0, 60)}" stoji za tabulkou${kat ? ` kategorie ${kat}/` : ''} - generator by ho smazal; presun ho mezi nadpis a tabulku`);
  }
  return text;
}

function oblastReadme(radky) {
  const start = radky.findIndex((l) => /^## Index\s*$/.test(l));
  if (start === -1) return null;
  let konec = start + 1;
  while (konec < radky.length && !/^## /.test(radky[konec])) konec++;
  return { start, konec };
}

const naRadky = (t) => String(t).split(/\r?\n/);
const eolOf = (t) => (/\r\n/.test(t) ? '\r\n' : '\n');

/**
 * Hlavni funkce: vrati novy obsah generovanych souboru a chyby. Nic nezapisuje.
 * @returns {{ vystup: Record<string,string>, chyby: string[] }}
 */
export function vygeneruj(fs) {
  const chyby = [];
  const vystup = {};
  if (!fs.exists('INDEX.md')) return { vystup, chyby: ['INDEX.md chybi - generator nema kam psat'] };
  const puvodniIndex = fs.read('INDEX.md');
  let index = naRadky(puvodniIndex);
  let nejnovejsi = '';

  for (const sekce of SEKCE) {
    const clanky = clankySekce(fs, sekce, chyby);
    for (const c of clanky) if (c.revize > nejnovejsi) nejnovejsi = c.revize;
    const o = oblastIndexu(index, sekce.dir);
    if (!o) {
      chyby.push(`INDEX.md: chybi radek sekce "- ... **[${sekce.dir}/](${sekce.dir}/)** ..." - generator nema kam psat`);
      continue;
    }
    const { kategorie, poradi } = poradiZIndexu(index.slice(o.start + 1, o.konec));
    const serazene = seradit(clanky, poradi);
    const vsechnyKat = [...new Set(serazene.filter((c) => !c.jeReadme).map((c) => c.kat))];
    const katPoradi = [
      ...kategorie.filter((k) => vsechnyKat.includes(k)),
      ...vsechnyKat.filter((k) => !kategorie.includes(k)).sort(),
    ];

    const nove = [];
    if (sekce.kategorie) {
      for (const c of serazene.filter((x) => x.jeReadme)) nove.push(`  - [${c.odkaz}](${c.rel}) — ${c.summary}`);
      for (const k of katPoradi) {
        nove.push(`  - **${k}/**`);
        for (const c of serazene.filter((x) => !x.jeReadme && x.kat === k)) nove.push(`    - [${c.odkaz}](${c.rel}) — ${c.summary}`);
      }
    } else {
      for (const c of serazene) nove.push(`  - [${c.odkaz}](${c.rel}) — ${c.summary}`);
    }
    index = [...index.slice(0, o.start + 1), ...nove, ...index.slice(o.konec)];

    if (!sekce.tabulka) continue;
    const relReadme = `${sekce.dir}/README.md`;
    if (!fs.exists(relReadme)) { chyby.push(`${relReadme} chybi`); continue; }
    const puvodniReadme = fs.read(relReadme);
    const readme = naRadky(puvodniReadme);
    const r = oblastReadme(readme);
    if (!r) { chyby.push(`${relReadme}: chybi nadpis "## Index" - generator nema kam psat`); continue; }
    const rucni = rucniText(readme.slice(r.start + 1, r.konec), relReadme, chyby);
    const tabulka = (seznam) => {
      const out = [sekce.tabulka, '|---|---|'];
      for (const c of seznam) out.push(`| [${bunka(c.odkaz)}](${c.rel.slice(sekce.dir.length + 1)}) | ${bunka(c.summary)} |`);
      return [...out, ''];
    };
    const obsah = [''];
    if (sekce.kategorie) {
      for (const k of katPoradi) {
        obsah.push(`### ${k}/`, '');
        if (rucni[k]) obsah.push(...rucni[k], '');
        obsah.push(...tabulka(serazene.filter((c) => !c.jeReadme && c.kat === k)));
      }
    } else {
      if (rucni['']) obsah.push(...rucni[''], '');
      obsah.push(...tabulka(serazene.filter((c) => !c.jeReadme)));
    }
    vystup[relReadme] = [...readme.slice(0, r.start + 1), ...obsah, ...readme.slice(r.konec)].join(eolOf(puvodniReadme));
  }

  if (nejnovejsi) index = index.map((l) => (/^\*Last updated: \d{4}-\d{2}-\d{2}\*\s*$/.test(l) ? `*Last updated: ${nejnovejsi}*` : l));
  vystup['INDEX.md'] = index.join(eolOf(puvodniIndex));
  return { vystup, chyby };
}

/** Rozdily vygenerovaneho obsahu proti souborum: [{ rel, radek, ma, cekam }]. */
export function rozdily(fs, vystup) {
  const out = [];
  for (const [rel, obsah] of Object.entries(vystup)) {
    const ted = fs.exists(rel) ? fs.read(rel) : '';
    if (ted === obsah) continue;
    const a = naRadky(ted);
    const b = naRadky(obsah);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    out.push({ rel, radek: i + 1, ma: a[i] === undefined ? '(konec souboru)' : a[i], cekam: b[i] === undefined ? '(konec souboru)' : b[i] });
  }
  return out;
}

// ── Selftest: obe polarity ───────────────────────────────────────────────
function selftest() {
  let chyb = 0;
  let tvrzeni = 0;
  const ok = (podminka, popis) => { tvrzeni++; if (!podminka) { chyb++; console.error(`  x  selftest: ${popis}`); } };

  // YAML podmnozina: co GitHub nevykreslil, se musi ohlasit; platne tvary projdou.
  ok(frontmatter('---\ntitle: `x` returns 400\n---\n').chyby.length === 1, 'titulek zacinajici backtickem prosel');
  ok(frontmatter('---\ntitle: A mailto: fallback\n---\n').chyby.length === 1, 'titulek s ": " prosel');
  ok(frontmatter('---\ntitle: "No such host" for x\n---\n').chyby.length === 1, 'titulek s textem za uzavrenou uvozovkou prosel');
  const jsonT = frontmatter('---\ntitle: "A \\"quoted\\" `x`: y"\nsummary: \'it\'\'s fine\'\ntags: [a, b-c]\n---\n');
  ok(jsonT.chyby.length === 0 && jsonT.data.title === 'A "quoted" `x`: y' && jsonT.data.summary === "it's fine" &&
    jsonT.data.tags.join('|') === 'a|b-c', 'platny frontmatter (JSON retezec, apostrofy, seznam) neprosel');
  ok(frontmatter('# bez frontmatteru\n').data === null, 'chybejici frontmatter se neohlasil');
  ok(frontmatter('---\nshort-title: 2026\nsummary: yes\n---\n').chyby.length === 2, 'textovy klic, ktery YAML precte jako cislo nebo logickou hodnotu, prosel');
  ok(frontmatter('---\nshort-title: "2026"\nsummary: 8 chapters, one lecturer\nchapter: 7\nlast-reviewed: 2026-09-24\n---\n').chyby.length === 0,
    'cislo v uvozovkach, text zacinajici cislici nebo netextovy klic (chapter, last-reviewed) se hlasi jako chyba');
  for (const s of ['`code` first', 'a: b', 'x #y', 'plain text — ok', "it's", '"q" start', '- dash', '1:30', 'true', ' lead', `a${String.fromCodePoint(0x2028)}b`]) {
    const zpet = hodnota(yamlText(s));
    ok(!zpet.chyba && zpet.value === s, `yamlText neprezije cestu tam a zpet: ${JSON.stringify(s)}`);
  }

  // Generovani nad malym stromem v pameti.
  const fm = (title, summary, extra = '') => `---\ntitle: ${yamlText(title)}\n${extra}${summary === null ? '' : `summary: ${yamlText(summary)}\n`}last-reviewed: 2026-09-01\n---\n\n# ${title}\n`;
  const zaklad = () => ({
    'INDEX.md': [
      '# Index', '', '*Last updated: 2026-01-01*', '',
      '- 💥 **[gotchas/](gotchas/)** — traps',
      '  - **b/**',
      '    - [Two](gotchas/b/two.md) — old text',
      '    - [Moved](gotchas/a/moved.md) — sits under the wrong category',
      '  - **a/**',
      '    - [One](gotchas/a/one.md) — x',
      '- 🧭 **[guides/](guides/)** — walkthroughs',
      '- 🎓 **[course/](course/)** — course',
      '- ✂️ **[snippets/](snippets/)** — fragments',
      '- 📄 **Repo meta**', '',
    ].join('\n'),
    'gotchas/README.md': '# G\n\n## Index\n\n### b/\n\nHand-written intro.\n\n| Gotcha | TL;DR |\n|---|---|\n| [x](b/two.md) | y |\n\n## Writing\n',
    'guides/README.md': '# Guides\n\n## Index\n\n| Guide | What it covers |\n|---|---|\n\n## Next\n',
    'snippets/README.md': '# S\n\n## Index\n\n## Planned\n',
    'gotchas/b/two.md': fm('Two', 'new text with a | pipe'),
    'gotchas/a/one.md': fm('One', 'one summary'),
    'gotchas/a/moved.md': fm('Moved', 'moved summary'),
    'gotchas/a/new.md': fm('A much longer title', 'brand new', 'short-title: New\n'),
    'guides/g.md': fm('Guide G', 'lower-case start'),
  });
  const soubory = zaklad();
  const { vystup, chyby } = vygeneruj(memFs(soubory));
  ok(chyby.length === 0, `platny strom hlasi chyby: ${chyby.join('; ')}`);
  const idx = vystup['INDEX.md'] || '';
  ok(idx.includes('*Last updated: 2026-09-01*'), 'Last updated se nevzal z nejnovejsiho last-reviewed');
  const pozice = (s) => idx.indexOf(s);
  ok(pozice('  - **b/**') < pozice('  - **a/**'), 'poradi kategorii z INDEXu se nezachovalo');
  ok(pozice('(gotchas/a/moved.md)') > pozice('  - **a/**'), 'clanek pod cizi kategorii se nepresunul do sve slozky');
  ok(pozice('(gotchas/a/moved.md)') < pozice('(gotchas/a/one.md)'), 'poradi uvnitr kategorie se nevzalo z pozice v INDEXu');
  ok(pozice('    - [New](gotchas/a/new.md) — brand new') > pozice('(gotchas/a/one.md)'), 'novy clanek neni na konci kategorie (nebo nepouzil short-title)');
  ok(idx.includes('    - [Two](gotchas/b/two.md) — new text with a | pipe'), 'INDEX nema popis ze summary');
  ok(idx.includes('  - [Guide G](guides/g.md) — lower-case start'), 'guide bez kategorie chybi v INDEXu');
  const g = vystup['gotchas/README.md'] || '';
  ok(g.includes('| [Two](b/two.md) | new text with a \\| pipe |'), 'README: svislitko neni escapovane (nebo generator meni text summary)');
  ok(g.includes('### b/\n\nHand-written intro.\n\n| Gotcha | TL;DR |'), 'rucni odstavec kategorie se ztratil');
  ok(g.indexOf('### b/') < g.indexOf('### a/') && g.endsWith('\n## Writing\n'), 'README: poradi kategorii nebo konec souboru nesedi');
  ok((vystup['guides/README.md'] || '').includes('| [Guide G](g.md) | lower-case start |\n\n## Next'), 'guides README se nevygeneroval');

  // Idempotence: generovani nad vlastnim vystupem nic nezmeni.
  const druhe = vygeneruj(memFs(Object.assign({}, soubory, vystup)));
  ok(Object.keys(vystup).every((k) => druhe.vystup[k] === vystup[k]), 'druhy beh zmenil vystup (neni idempotentni)');
  // Kontrola: shoda = zadny rozdil; zmeneny summary = rozdil.
  ok(rozdily(memFs(Object.assign({}, soubory, vystup)), vystup).length === 0, 'shodny strom hlasi rozdil');
  const zmeneny = Object.assign({}, soubory, vystup, { 'gotchas/a/one.md': fm('One', 'edited summary') });
  const po = vygeneruj(memFs(zmeneny));
  ok(rozdily(memFs(zmeneny), po.vystup).some((d) => d.rel === 'INDEX.md'), 'zmeneny summary nezpusobil rozdil v INDEX.md');

  // Hranate zavorky v `kodu` textu odkazu jsou v poradku (a nesmi rozbit cteni poradi), mimo kod ne.
  const zavorky = zaklad();
  zavorky['INDEX.md'] = zavorky['INDEX.md'].replace('    - [One](gotchas/a/one.md) — x', '    - [PS7 `[ref]` x](gotchas/a/ref.md) — r\n    - [One](gotchas/a/one.md) — x');
  zavorky['gotchas/a/ref.md'] = fm('PS7 `[ref]` x', 'r');
  const zv = vygeneruj(memFs(zavorky));
  const zi = zv.vystup['INDEX.md'] || '';
  ok(zv.chyby.length === 0 && zi.indexOf('(gotchas/a/ref.md)') !== -1 && zi.indexOf('(gotchas/a/ref.md)') < zi.indexOf('(gotchas/a/one.md)'),
    'odkaz s `[ref]` v kodu hlasi chybu nebo ztratil poradi z INDEXu');
  const zavorkyVen = vygeneruj(memFs(Object.assign(zaklad(), { 'gotchas/a/one.md': fm('One [draft]', 'x') })));
  ok(zavorkyVen.chyby.some((c) => c.includes('smi mit [ ] jen uvnitr')), 'hranate zavorky mimo kod v textu odkazu prosly');

  // Chyby, ktere se musi ohlasit (a nic nevygenerovat spatne).
  const bez = vygeneruj(memFs(Object.assign(zaklad(), { 'gotchas/a/one.md': fm('One', null) })));
  ok(bez.chyby.some((c) => c.startsWith('gotchas/a/one.md: chybi summary')), 'chybejici summary se neohlasil');
  const odkaz = vygeneruj(memFs(Object.assign(zaklad(), { 'gotchas/a/one.md': fm('One', 'see [x](../y.md)') })));
  ok(odkaz.chyby.some((c) => c.includes('nesmi obsahovat odkaz')), 'odkaz v summary se neohlasil');
  const volny = vygeneruj(memFs(Object.assign(zaklad(), { 'gotchas/loose.md': fm('Loose', 's') })));
  ok(volny.chyby.some((c) => c.startsWith('gotchas/loose.md: clanek patri do podslozky')), 'gotcha mimo kategorii se neohlasila');
  const zaTabulkou = zaklad();
  zaTabulkou['gotchas/README.md'] = zaTabulkou['gotchas/README.md'].replace('\n\n## Writing', '\nA note after the table.\n\n## Writing');
  ok(vygeneruj(memFs(zaTabulkou)).chyby.some((c) => c.includes('stoji za tabulkou')), 'text za tabulkou se neohlasil (generator by ho smazal)');
  const bezSekce = zaklad();
  bezSekce['INDEX.md'] = bezSekce['INDEX.md'].replace('- 🧭 **[guides/](guides/)** — walkthroughs\n', '');
  ok(vygeneruj(memFs(bezSekce)).chyby.some((c) => c.startsWith('INDEX.md: chybi radek sekce "- ... **[guides/]')), 'chybejici radek sekce v INDEXu se neohlasil');

  console.log(chyb ? `build-index --selftest: SELHAL (${chyb} z ${tvrzeni})` : `build-index --selftest: OK (${tvrzeni} tvrzeni vcetne obou polarit)`);
  return chyb ? 1 : 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────
function main() {
  const argy = process.argv.slice(2);
  if (argy.includes('--selftest')) process.exit(selftest());
  const cesty = argy.filter((a) => !a.startsWith('--'));
  const root = resolve(cesty[0] || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const fs = diskFs(root);
  const { vystup, chyby } = vygeneruj(fs);
  if (chyby.length) {
    console.error(`build-index: ${chyby.length} chyb ve frontmatteru nebo indexech - nic se nezapsalo:`);
    for (const c of chyby) console.error(`  x ${c}`);
    process.exit(1);
  }
  const rozdil = rozdily(fs, vystup);
  if (argy.includes('--check')) {
    if (!rozdil.length) { console.log('build-index --check: indexy odpovidaji frontmatteru.'); process.exit(0); }
    for (const d of rozdil) console.error(`  x ${d.rel}, radek ${d.radek}: je "${d.ma.slice(0, 80)}", ma byt "${d.cekam.slice(0, 80)}"`);
    console.error('build-index --check: indexy se lisi od frontmatteru - spust node tools/build-index.mjs');
    process.exit(1);
  }
  for (const d of rozdil) writeFileSync(join(root, d.rel), vystup[d.rel], 'utf8');
  console.log(rozdil.length ? `build-index: prepsano ${rozdil.map((d) => d.rel).join(', ')}` : 'build-index: beze zmeny.');
}

const spusteno = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (spusteno) main();
